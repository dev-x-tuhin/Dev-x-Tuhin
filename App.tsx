import React, { useState, useRef, useEffect } from 'react';
import { useLiveSession } from './hooks/useLiveSession';
import AudioVisualizer from './components/AudioVisualizer';
import { Message } from './types';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Helper to update messages without duplicates based on ID
  const handleMessage = (newMessage: Message) => {
    setMessages(prev => {
      // If we have a partial message with same ID (or same logic), update it
      // Since our logic generates unique IDs for partial vs final, 
      // we need to be careful.
      // Logic from hook: partials have unique IDs per update? No, let's check hook logic.
      // Hook: `id: Date.now().toString() + 'model'` -> This creates a new ID every chunk. 
      // This is bad for react list. We should consolidate.
      // To fix this simple demo: We will just filter out previous partials of same role if a new one comes?
      // Better approach for chat UI:
      // If last message is same role and isPartial, replace it.
      
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.role === newMessage.role && lastMsg.isPartial && newMessage.isPartial) {
        // Update last message content
        const updated = [...prev];
        updated[prev.length - 1] = newMessage;
        return updated;
      }
      
      // If last was partial and this is final (same role), replace
      if (lastMsg && lastMsg.role === newMessage.role && lastMsg.isPartial && !newMessage.isPartial) {
         const updated = [...prev];
         updated[prev.length - 1] = newMessage;
         return updated;
      }

      return [...prev, newMessage];
    });
  };

  const { connect, disconnect, isConnected, isConnecting, inputAnalyser, outputAnalyser } = useLiveSession({
    onMessage: handleMessage,
    onError: (err) => setError(err.message),
    onDisconnect: () => console.log('Disconnected'),
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 font-sans">
      {/* Header */}
      <header className="p-4 bg-slate-800/50 backdrop-blur-md border-b border-slate-700 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold font-bengali">বন্ধু (Bondhu) AI</h1>
            <p className="text-xs text-slate-400">Bangla Live Assistant</p>
          </div>
        </div>
        <div className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700">
          Gemini 2.5 Flash
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden flex flex-col relative">
        
        {/* Visualizer Area (Centered when idle/active) */}
        <div className={`flex-1 flex flex-col items-center justify-center transition-all duration-500 ${messages.length > 0 ? 'min-h-[300px]' : 'h-full'}`}>
          <div className="relative w-full max-w-md aspect-square flex flex-col items-center justify-center">
            {/* Connection Status Text */}
            <div className="absolute top-10 text-center z-10">
                {!isConnected && !isConnecting && (
                  <p className="text-slate-400">Tap the mic to start speaking Bengali</p>
                )}
                {isConnecting && (
                  <p className="text-emerald-400 animate-pulse">Connecting to Gemini...</p>
                )}
                {isConnected && (
                  <p className="text-emerald-400 font-bengali">আমি শুনছি... (Listening)</p>
                )}
                 {error && (
                  <p className="text-red-400 bg-red-900/20 px-4 py-2 rounded-lg mt-2 text-sm">{error}</p>
                )}
            </div>

            {/* Visualizer */}
            <AudioVisualizer 
              analyser={isConnected ? (outputAnalyser || inputAnalyser) : null} 
              isActive={isConnected} 
              accentColor={isConnected ? '#34d399' : '#64748b'}
            />
          </div>
        </div>

        {/* Transcript Overlay / List */}
        {messages.length > 0 && (
          <div className="flex-1 overflow-y-auto px-4 pb-24 scrollbar-hide mask-image-linear-gradient">
             <div className="max-w-2xl mx-auto space-y-4 pt-4">
                {messages.map((msg, idx) => (
                  <div 
                    key={msg.id + idx} 
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div 
                      className={`max-w-[80%] px-4 py-3 rounded-2xl text-lg font-bengali leading-relaxed shadow-sm ${
                        msg.role === 'user' 
                          ? 'bg-slate-700 text-slate-100 rounded-br-none' 
                          : 'bg-emerald-600/20 text-emerald-100 border border-emerald-500/20 rounded-bl-none'
                      }`}
                    >
                      {msg.text}
                      {msg.isPartial && <span className="inline-block w-2 h-4 ml-1 bg-current opacity-50 animate-pulse">|</span>}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
             </div>
          </div>
        )}

      </main>

      {/* Footer Controls */}
      <div className="absolute bottom-8 left-0 right-0 flex justify-center z-20">
         <button
            onClick={isConnected ? disconnect : connect}
            disabled={isConnecting}
            className={`
              relative group w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300
              ${isConnected 
                ? 'bg-red-500 hover:bg-red-600 shadow-red-500/40' 
                : 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/40'
              }
              ${isConnecting ? 'opacity-80 cursor-wait' : 'cursor-pointer'}
            `}
         >
            {/* Ripple Effect Ring when active */}
            {isConnected && (
               <span className="absolute inset-0 rounded-full border-4 border-white/20 animate-ping"></span>
            )}
            
            {/* Icon */}
            {isConnected ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
         </button>
      </div>
    </div>
  );
};

export default App;