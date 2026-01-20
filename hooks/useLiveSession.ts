import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { base64ToBytes, createBlob, decodeAudioData } from '../utils/audioUtils';
import { Message } from '../types';

interface UseLiveSessionProps {
  onMessage: (message: Message) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

export const useLiveSession = ({ onMessage, onConnect, onDisconnect, onError }: UseLiveSessionProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Audio Contexts and Nodes
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  
  // Session State
  const sessionRef = useRef<any>(null); // To store the session promise/object
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Transcription Buffers
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  const connect = useCallback(async () => {
    if (isConnected || isConnecting) return;
    setIsConnecting(true);

    try {
      const apiKey = process.env.API_KEY;
      if (!apiKey) throw new Error("API Key not found");

      const ai = new GoogleGenAI({ apiKey });
      
      // Initialize Audio Contexts
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const inputCtx = new AudioContextClass({ sampleRate: 16000 });
      const outputCtx = new AudioContextClass({ sampleRate: 24000 });
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      // Setup Analysers for visualization
      const inAnalyser = inputCtx.createAnalyser();
      inAnalyser.fftSize = 256;
      inputAnalyserRef.current = inAnalyser;

      const outAnalyser = outputCtx.createAnalyser();
      outAnalyser.fftSize = 256;
      outputAnalyserRef.current = outAnalyser;

      // Connect Output Analyser to destination
      // We will connect sources -> analyser -> destination later
      
      // Get Microphone Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            console.log('Session opened');
            setIsConnected(true);
            setIsConnecting(false);
            onConnect?.();

            // Setup Input Processing
            const source = inputCtx.createMediaStreamSource(stream);
            // Connect to analyser for visualization
            source.connect(inAnalyser);
            
            // Setup ScriptProcessor for PCM streaming
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              
              // Send to Gemini
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBytes = base64ToBytes(base64Audio);
              const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
              
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              
              // Connect source -> analyser -> destination
              if (outputAnalyserRef.current) {
                source.connect(outputAnalyserRef.current);
                outputAnalyserRef.current.connect(ctx.destination);
              } else {
                source.connect(ctx.destination);
              }
              
              source.addEventListener('ended', () => {
                audioSourcesRef.current.delete(source);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              audioSourcesRef.current.add(source);
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              console.log('Interrupted, clearing audio queue');
              audioSourcesRef.current.forEach(source => {
                try { source.stop(); } catch (e) { /* ignore */ }
              });
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }

            // Handle Transcription
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscription.current += message.serverContent.outputTranscription.text;
              onMessage({
                id: Date.now().toString() + 'model',
                role: 'model',
                text: currentOutputTranscription.current,
                timestamp: new Date(),
                isPartial: true
              });
            } else if (message.serverContent?.inputTranscription) {
              currentInputTranscription.current += message.serverContent.inputTranscription.text;
               onMessage({
                id: Date.now().toString() + 'user',
                role: 'user',
                text: currentInputTranscription.current,
                timestamp: new Date(),
                isPartial: true
              });
            }

            // Turn Complete (Finalize Transcripts)
            if (message.serverContent?.turnComplete) {
              if (currentInputTranscription.current) {
                 onMessage({
                  id: Date.now().toString() + 'user_final',
                  role: 'user',
                  text: currentInputTranscription.current,
                  timestamp: new Date(),
                  isPartial: false
                });
                currentInputTranscription.current = '';
              }
              
              if (currentOutputTranscription.current) {
                 onMessage({
                  id: Date.now().toString() + 'model_final',
                  role: 'model',
                  text: currentOutputTranscription.current,
                  timestamp: new Date(),
                  isPartial: false
                });
                currentOutputTranscription.current = '';
              }
            }
          },
          onclose: (e) => {
            console.log('Session closed', e);
            cleanup();
          },
          onerror: (e) => {
            console.error('Session error', e);
            onError?.(new Error("Connection error"));
            cleanup();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          systemInstruction: `You are 'Bondhu', a warm, intelligent, and helpful Bengali daily life assistant. 
          You speak fluent Bengali (Bangla).
          You are conversational, witty, and empathetic.
          Keep responses concise and natural for voice conversation.
          If asked about your identity, say you are a Bangla AI assistant created to help with daily tasks.`,
          // Updated transcription config: pass empty objects to enable
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });
      
      sessionRef.current = sessionPromise;

    } catch (err) {
      console.error(err);
      setIsConnecting(false);
      onError?.(err instanceof Error ? err : new Error('Failed to connect'));
    }
  }, [isConnected, isConnecting, onConnect, onDisconnect, onError, onMessage]);

  const cleanup = useCallback(() => {
    setIsConnected(false);
    setIsConnecting(false);
    
    // Stop tracks
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    
    // Disconnect nodes
    scriptProcessorRef.current?.disconnect();
    inputAnalyserRef.current?.disconnect();
    outputAnalyserRef.current?.disconnect();
    
    // Close Contexts
    inputAudioContextRef.current?.close();
    outputAudioContextRef.current?.close();
    
    // Clear refs
    mediaStreamRef.current = null;
    scriptProcessorRef.current = null;
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;
    
    // Attempt to close session if method exists (it usually doesn't on the promise itself, but let's be safe)
    if (sessionRef.current) {
        sessionRef.current.then((session: any) => {
             if(session.close) session.close();
        }).catch(() => {});
    }
    sessionRef.current = null;
    
    onDisconnect?.();
  }, [onDisconnect]);

  const disconnect = useCallback(() => {
    cleanup();
  }, [cleanup]);

  return {
    connect,
    disconnect,
    isConnected,
    isConnecting,
    inputAnalyser: inputAnalyserRef.current,
    outputAnalyser: outputAnalyserRef.current,
  };
};