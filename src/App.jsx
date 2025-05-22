import React, { useState, useEffect, useRef } from 'react';
    import { createRoot } from 'react-dom/client';
    import { openDB } from 'idb';

    // #region Utility Files
    const DB_NAME = 'RepoChatDB';
    const DB_VERSION = 1;
    const CHAT_HISTORY_STORE = 'chatHistory';
    const FILE_SUMMARIES_STORE = 'fileSummaries';

    const getDB = async () => {
      try {
        const db = await openDB(DB_NAME, DB_VERSION, {
          upgrade(db) {
            if (!db.objectStoreNames.contains(CHAT_HISTORY_STORE)) {
              db.createObjectStore(CHAT_HISTORY_STORE, { keyPath: 'chatId' });
            }
            if (!db.objectStoreNames.contains(FILE_SUMMARIES_STORE)) {
              db.createObjectStore(FILE_SUMMARIES_STORE, { keyPath: 'filePath' });
            }
          },
        });
        console.log('Database opened successfully');
        return db;
      } catch (error) {
        console.error('Error opening database:', error);
        throw error;
      }
    };

    const saveChatMessages = async (chatId, messages) => {
      try {
        const db = await getDB();
        await db.put(CHAT_HISTORY_STORE, { chatId, messages, updatedAt: new Date() });
        console.log(`Chat messages saved for chatId: ${chatId}`);
      } catch (error) {
        console.error('Error saving chat messages:', error);
      }
    };

    const loadChatMessages = async (chatId) => {
      try {
        const db = await getDB();
        const chatData = await db.get(CHAT_HISTORY_STORE, chatId);
        console.log(`Chat messages loaded for chatId: ${chatId}`, chatData);
        return chatData ? chatData.messages : null;
      } catch (error) {
        console.error('Error loading chat messages:', error);
        return null;
      }
    };

    const saveFileSummary = async (filePath, summary, repoId = 'currentRepo') => {
      try {
        const db = await getDB();
        const key = `${repoId}_${filePath}`;
        await db.put(FILE_SUMMARIES_STORE, { filePath: key, summary, repoId, originalPath: filePath, updatedAt: new Date() });
        console.log(`Summary saved for file: ${filePath} with key: ${key}`);
      } catch (error) {
        console.error(`Error saving file summary for ${filePath}:`, error);
        throw error; // Rethrow to catch in handleFilesSelected
      }
    };

    const getFileSummary = async (filePath, repoId = 'currentRepo') => {
      try {
        const db = await getDB();
        const key = `${repoId}_${filePath}`;
        const summary = await db.get(FILE_SUMMARIES_STORE, key);
        console.log(`Fetched summary for file: ${filePath} with key: ${key}`, summary);
        return summary;
      } catch (error) {
        console.error(`Error getting file summary for ${filePath}:`, error);
        return null;
      }
    };

    const getAllFileSummariesForRepo = async (repoId = 'currentRepo') => {
      try {
        const db = await getDB();
        const allSummaries = await db.getAll(FILE_SUMMARIES_STORE);
        const filteredSummaries = allSummaries.filter(s => s.repoId === repoId);
        console.log(`Fetched ${filteredSummaries.length} summaries for repoId: ${repoId}`, filteredSummaries);
        return filteredSummaries;
      } catch (error) {
        console.error('Error getting all file summaries for repo:', error);
        return [];
      }
    };

    const sendToGemini = async (prompt, type = "summarize_file", fileDetails = null, repoId = 'currentRepo') => {
      const apiKey = "API KEY"; // Replace with actual API key
      const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

      let fullPrompt = prompt;

      if (type === "summarize_file" && fileDetails) {
        fullPrompt = `Analyze the following code from the file named "${fileDetails.fileName}". Provide a detailed summary (4-6 sentences) that includes:
- The main purpose of the file.
- Key functions, classes, or components defined (if any).
- Notable dependencies or imports used.
- How the file interacts with other parts of the codebase (e.g., data flow, API calls, or UI rendering).
- Any unique patterns, configurations, or notable implementations.
Output format should be plain text, clear, and structured for easy reading.

CODE:
${fileDetails.content}`;
      } else if (type === "general_query") {
        const allSummaries = await getAllFileSummariesForRepo(repoId);
        console.log('All summaries for general query:', allSummaries);
        if (allSummaries.length > 0) {
          const summariesText = allSummaries.map(s => `File: ${s.originalPath}\nSummary: ${s.summary}\n`).join("\n---\n");
          const maxContextLength = 100000;
          const truncatedSummariesText = summariesText.length > maxContextLength ? summariesText.substring(0, maxContextLength) + "..." : summariesText;

          const isRepoOverviewQuery = prompt.toLowerCase().includes("what is this repo about") || 
                                     prompt.toLowerCase().includes("repository purpose") || 
                                     prompt.toLowerCase().includes("project overview");
          const isFileCountQuery = prompt.toLowerCase().includes("how many files") || 
                                  prompt.toLowerCase().includes("number of files");

          if (isFileCountQuery) {
            fullPrompt = `The repository contains ${allSummaries.length} files, as determined by the number of file summaries stored. Below are the detailed summaries of these files for additional context, if needed.

Repository File Summaries:
${truncatedSummariesText}

User Query: ${prompt}`;
          } else if (isRepoOverviewQuery) {
            fullPrompt = `You are an AI assistant analyzing a codebase. Below are detailed summaries of the files in the current repository. Based on these summaries, provide a high-level overview (3-5 sentences) of the repository's purpose, main functionality, and key components. Highlight the overall architecture, primary features, and any notable technologies or patterns used. If possible, infer the type of application or system this repository represents.

Repository File Summaries:
${truncatedSummariesText}

User Query: ${prompt}`;
          } else {
            fullPrompt = `You are an AI assistant analyzing a codebase. Below are detailed summaries of the files in the current repository to provide context for answering the user's query. Use this information to give accurate, codebase-specific responses, including references to specific files, functions, or components where relevant. If the query is broad, leverage the summaries to infer relationships or provide insights about the codebase structure.

Repository File Summaries:
${truncatedSummariesText}

User Query: ${prompt}`;
          }
        } else {
          fullPrompt = `User Query: ${prompt}\n\n(No file summaries available for context. Answer based on general knowledge, and inform the user that no repository data is available.)`;
        }
      }

      console.log('Sending payload to Gemini API:', {
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {},
      });

      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: {
              // temperature: 0.7,
              // maxOutputTokens: 1000,
            }
          })
        });

        if (!res.ok) {
          const errorBody = await res.json();
          throw new Error(`Gemini API request failed with status ${res.status}: ${errorBody?.error?.message || 'Unknown error'}`);
        }

        const data = await res.json();
        
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0) {
          return data.candidates[0].content.parts[0].text;
        } else if (data.promptFeedback && data.promptFeedback.blockReason) {
          console.warn("Gemini API prompt blocked:", data.promptFeedback);
          return `Content blocked by API: ${data.promptFeedback.blockReason}${data.promptFeedback.blockReasonMessage ? ' - ' + data.promptFeedback.blockReasonMessage : ''}`;
        } else {
          console.warn("No response or unexpected format from Gemini API:", data);
          return 'No valid response or unexpected format from AI.';
        }
      } catch (error) {
        console.error('Error calling Gemini API:', error);
        return `Error communicating with AI: ${error.message}`;
      }
    };
    // #endregion Utility Files

    const Header = () => (
      <header className="bg-gray-900 shadow-md p-4">
        <h1 className="text-2xl font-bold text-center text-white">AI Code Repository Analyzer</h1>
      </header>
    );

    const RepoControls = ({ onFilesSelected, files, statusMessage, isProcessing, onDebugSummaries }) => {
      const fileInputRef = useRef(null);

      const handleSelectRepoClick = () => {
        fileInputRef.current.click();
      };

      const handleFileChange = (event) => {
        onFilesSelected(event.target.files);
      };

      return (
        <aside className="w-full lg:w-1/3 bg-gray-800 rounded-lg shadow-lg p-6 flex flex-col overflow-hidden">
          <h2 className="text-xl font-semibold mb-4 text-gray-200">Repository Controls</h2>
          
          <button 
            onClick={handleSelectRepoClick}
            disabled={isProcessing}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg shadow transition duration-150 ease-in-out mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Processing...' : 'Select Repository'}
          </button>
          <input 
            type="file" 
            id="fileInput" 
            ref={fileInputRef} 
            webkitdirectory="" 
            directory="" 
            multiple 
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={isProcessing}
          />

          <button 
            onClick={onDebugSummaries}
            disabled={isProcessing}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-lg shadow transition duration-150 ease-in-out mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Show Stored Summaries
          </button>

          <div id="statusMessage" className="text-sm text-yellow-400 mb-4 h-10 break-words">
            {statusMessage}
          </div>

          <h3 className="text-lg font-medium mb-2 text-gray-300">File Structure (Filtered)</h3>
          <div id="fileList" className="flex-1 overflow-y-auto bg-gray-700 p-3 rounded-md border border-gray-600 min-h-[200px]">
            {files.length === 0 && !isProcessing ? (
              <p className="text-gray-400 text-sm">No repository selected or all files filtered out.</p>
            ) : isProcessing && files.length === 0 ? (
              <p className="text-gray-400 text-sm">Initializing file list...</p>
            ) : (
              files.map((file, index) => (
                <div 
                  key={index} 
                  className="text-sm text-gray-300 p-1.5 rounded hover:bg-gray-600 truncate"
                  title={file.webkitRelativePath || file.name}
                >
                  {file.webkitRelativePath || file.name}
                </div>
              ))
            )}
          </div>
        </aside>
      );
    };

    const ChatInterface = ({ messages, onSendMessage, isAiThinking }) => {
      const [inputValue, setInputValue] = useState('');
      const chatDisplayRef = useRef(null);

      useEffect(() => {
        if (chatDisplayRef.current) {
          chatDisplayRef.current.scrollTop = chatDisplayRef.current.scrollHeight;
        }
      }, [messages]);

      const handleInputChange = (e) => {
        setInputValue(e.target.value);
      };

      const handleSend = () => {
        if (inputValue.trim() && !isAiThinking) {
          onSendMessage(inputValue.trim());
          setInputValue('');
        }
      };

      const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
          handleSend();
        }
      };

      return (
        <main className="w-full lg:w-2/3 bg-gray-800 rounded-lg shadow-lg p-6 flex flex-col overflow-hidden">
          <h2 className="text-xl font-semibold mb-4 text-gray-200">Chat with Your Codebase</h2>
          
          <div ref={chatDisplayRef} id="chatDisplay" className="flex-1 overflow-y-auto mb-4 p-4 bg-gray-700 rounded-md border border-gray-600 min-h-[300px]">
            {messages.map((msg, index) => (
              <div 
                key={index} 
                className={`chat-bubble ${msg.sender === 'User' ? 'user-bubble' : msg.sender === 'System' ? 'system-bubble' : 'ai-bubble'}`}
              >
                {typeof msg.text === 'string' ? msg.text.split('\n').map((line, i) => (
                  <span key={i}>{line}{i === msg.text.split('\n').length -1 ? '' : <br/>}</span>
                )) : msg.text}
              </div>
            ))}
          </div>

          <div className="mt-auto flex gap-3">
            <input 
              type="text" 
              id="chatInput" 
              value={inputValue}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              className="flex-grow p-3 border border-gray-600 rounded-lg bg-gray-700 text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
              placeholder="Ask something about your code..."
              disabled={isAiThinking}
            />
            <button 
              id="sendBtn"
              onClick={handleSend}
              disabled={isAiThinking}
              className="bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg shadow transition duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAiThinking ? 'Thinking...' : 'Send'}
            </button>
          </div>
        </main>
      );
    };

    const readFileContent = (file) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = err => reject(err);
        reader.readAsText(file);
      });
    };

   export default function App() {
      const [selectedFiles, setSelectedFiles] = useState([]);
      const [statusMessage, setStatusMessage] = useState('Please select a repository to begin.');
      const [chatMessages, setChatMessages] = useState([
        { sender: 'AI', text: 'Hello! Select a repository to begin analysis.' }
      ]);
      const [isProcessingFiles, setIsProcessingFiles] = useState(false);
      const [isAiThinkingQuery, setIsAiThinkingQuery] = useState(false);
      const [currentChatId, setCurrentChatId] = useState(null);
      const repoIdRef = useRef(null);

      useEffect(() => {
        document.body.style.fontFamily = "'Inter', sans-serif";
        document.body.style.backgroundColor = "#111827";
        document.body.style.color = "#e5e7eb";
        
        const styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.innerText = `
          .chat-bubble { max-width: 75%; padding: 10px 15px; border-radius: 15px; margin-bottom: 10px; word-wrap: break-word; }
          .user-bubble { background-color: #3b82f6; color: white; margin-left: auto; border-bottom-right-radius: 5px; }
          .ai-bubble { background-color: #374151; color: #e5e7eb; margin-right: auto; border-bottom-left-radius: 5px; }
          .system-bubble { background-color: #4b5563; color: #d1d5db; margin: 10px auto; padding: 8px 12px; font-size: 0.8rem; border-radius: 8px; text-align: center; }
          ::-webkit-scrollbar { width: 8px; }
          ::-webkit-scrollbar-track { background: #1f2937; border-radius: 10px; }
          ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 10px; }
          ::-webkit-scrollbar-thumb:hover { background: #6b7280; }
        `;
        document.head.appendChild(styleSheet);
        return () => {
          if (document.head.contains(styleSheet)) {
            document.head.removeChild(styleSheet);
          }
        }
      }, []);

      const addMessage = (sender, text) => {
        setChatMessages(prev => [...prev, { sender, text }]);
      };

      const handleFilesSelected = async (filesFromInput) => {
        if (!filesFromInput || filesFromInput.length === 0) {
          setStatusMessage('No files selected or selection cancelled.');
          return;
        }

        setIsProcessingFiles(true);
        const newChatId = `chat-${Date.now()}`;
        setCurrentChatId(newChatId);
        repoIdRef.current = `repo-${Date.now()}`;
        console.log('New repoId assigned:', repoIdRef.current);

        setChatMessages([{ sender: 'AI', text: 'Hello! Select a repository to begin analysis.' }]);
        addMessage('System', `Starting analysis for new repository. Chat ID: ${newChatId}`);
        
        const filesArray = Array.from(filesFromInput);
        const filteredFiles = filesArray.filter(file => {
          const path = file.webkitRelativePath || file.name;
          const lowerPath = path.toLowerCase();
          return !lowerPath.includes('/node_modules/') && 
                 !lowerPath.startsWith('node_modules/') &&
                 !lowerPath.includes('/.git/') && 
                 !lowerPath.startsWith('.git/') &&
                 !lowerPath.includes('/.vscode/') && 
                 !lowerPath.startsWith('.vscode/') &&
                 !lowerPath.endsWith('.log') &&
                 !lowerPath.endsWith('.lock') &&
                 !lowerPath.includes('/dist/') &&
                 !lowerPath.includes('/build/');
        });

        if (filteredFiles.length === 0) {
          setStatusMessage('No processable files found after filtering (e.g., node_modules, .git excluded).');
          addMessage('System', 'No processable files found after filtering.');
          setSelectedFiles([]);
          setIsProcessingFiles(false);
          await saveChatMessages(newChatId, chatMessages);
          return;
        }
        
        setSelectedFiles(filteredFiles);
        setStatusMessage(`Processing ${filteredFiles.length} files (excluding common ignored directories)...`);

        let currentMessages = [{ sender: 'AI', text: 'Hello! Select a repository to begin analysis.' }, { sender: 'System', text: `Starting analysis for new repository. Chat ID: ${newChatId}`}];

        for (let i = 0; i < filteredFiles.length; i++) {
          const file = filteredFiles[i];
          const filePath = file.webkitRelativePath || file.name;
          setStatusMessage(`Processing file ${i + 1}/${filteredFiles.length}: ${filePath}`);
          currentMessages.push({ sender: 'System', text: `Analyzing: ${filePath}` });
          setChatMessages([...currentMessages]);

          try {
            const content = await readFileContent(file);
            const MAX_CONTENT_LENGTH = 700000;
            let fileContentForApi = content;
            if (content.length > MAX_CONTENT_LENGTH) {
              fileContentForApi = content.substring(0, MAX_CONTENT_LENGTH) + "\n... (file truncated due to size)";
              currentMessages.push({ sender: 'System', text: `File ${filePath} was truncated for API analysis due to its size.` });
              setChatMessages([...currentMessages]);
            }

            const summary = await sendToGemini(null, "summarize_file", { fileName: filePath, content: fileContentForApi }, repoIdRef.current);
            
            currentMessages.push({ sender: 'AI', text: `Summary for ${filePath}:\n${summary}` });
            setChatMessages([...currentMessages]);
            
            await saveFileSummary(filePath, summary, repoIdRef.current);

            // Verify summary was saved
            const savedSummary = await getFileSummary(filePath, repoIdRef.current);
            if (!savedSummary) {
              console.warn(`Summary not found after saving for ${filePath}`);
              currentMessages.push({ sender: 'System', text: `Warning: Summary for ${filePath} could not be verified in storage.` });
              setChatMessages([...currentMessages]);
            }

          } catch (error) {
            console.error(`Error processing file ${filePath}:`, error);
            currentMessages.push({ sender: 'System', text: `Error processing ${filePath}: ${error.message}` });
            setChatMessages([...currentMessages]);
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Verify all summaries after processing
        const allSummaries = await getAllFileSummariesForRepo(repoIdRef.current);
        currentMessages.push({ sender: 'System', text: `Processed ${filteredFiles.length} files. Found ${allSummaries.length} summaries in storage.` });
        setChatMessages([...currentMessages]);

        setStatusMessage(`Processed ${filteredFiles.length} files. Ready to query!`);
        currentMessages.push({ sender: 'AI', text: `All ${filteredFiles.length} files processed. You can now ask questions about the codebase.` });
        setChatMessages([...currentMessages]);
        await saveChatMessages(newChatId, currentMessages);
        setIsProcessingFiles(false);
      };

      const handleSendMessage = async (messageText) => {
        if (!currentChatId) {
          addMessage('System', 'Please select and process a repository first.');
          return;
        }
        
        const userMsg = { sender: 'User', text: messageText };
        setChatMessages(prev => [...prev, userMsg]);
        setIsAiThinkingQuery(true);
        setStatusMessage('AI is thinking...');

        try {
          // Verify summaries before sending query
          const allSummaries = await getAllFileSummariesForRepo(repoIdRef.current);
          console.log('Summaries before query:', allSummaries);
          if (allSummaries.length === 0) {
            addMessage('System', 'No summaries found in storage. Please reprocess the repository.');
            setChatMessages(prev => [...prev, { sender: 'AI', text: 'No repository data available. Please upload and process a repository first.' }]);
            await saveChatMessages(currentChatId, [...chatMessages, userMsg, { sender: 'AI', text: 'No repository data available. Please upload and process a repository first.' }]);
          } else {
            const aiResponseText = await sendToGemini(messageText, "general_query", null, repoIdRef.current);
            const aiMsg = { sender: 'AI', text: aiResponseText };
            setChatMessages(prev => [...prev, aiMsg]);
            await saveChatMessages(currentChatId, [...chatMessages, userMsg, aiMsg]);
          }
        } catch (error) {
          console.error('Error in handleSendMessage:', error);
          const errorMsg = { sender: 'System', text: `Error getting AI response: ${error.message}` };
          setChatMessages(prev => [...prev, errorMsg]);
          await saveChatMessages(currentChatId, [...chatMessages, userMsg, errorMsg]);
        } finally {
          setStatusMessage('Ready to query!');
          setIsAiThinkingQuery(false);
        }
      };

      const handleDebugSummaries = async () => {
        const allSummaries = await getAllFileSummariesForRepo(repoIdRef.current);
        if (allSummaries.length === 0) {
          addMessage('System', 'No summaries found in storage for the current repository.');
        } else {
          const summaryText = allSummaries.map(s => `File: ${s.originalPath}\nSummary: ${s.summary}\n`).join("\n---\n");
          addMessage('System', `Stored Summaries (${allSummaries.length}):\n${summaryText}`);
        }
      };

      return (
        <div className="flex flex-col h-screen">
          <Header />
          <div className="flex flex-1 overflow-hidden p-4 gap-4 flex-col lg:flex-row">
            <RepoControls 
              onFilesSelected={handleFilesSelected} 
              files={selectedFiles} 
              statusMessage={statusMessage} 
              isProcessing={isProcessingFiles}
              onDebugSummaries={handleDebugSummaries}
            />
            <ChatInterface 
              messages={chatMessages} 
              onSendMessage={handleSendMessage}
              isAiThinking={isAiThinkingQuery || isProcessingFiles}
            />
          </div>
        </div>
      );
    }