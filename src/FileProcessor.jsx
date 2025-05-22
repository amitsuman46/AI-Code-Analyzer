import React, { useState } from 'react';
import { sendToGemini } from './utils/gemini';
import { saveChat, loadChat } from './utils/db';
import { processFiles } from './FileProcessor';

const FileProcessor = () => {
  const [messages, setMessages] = useState([]);

  const handleFolderUpload = async (e) => {
    const files = Array.from(e.target.files).filter(f => f.type === 'text/plain' || f.name.endsWith('.js') || f.name.endsWith('.ts') || f.name.endsWith('.jsx') || f.name.endsWith('.tsx'));
    const chatId = 'chat-' + Date.now();

    const fileSummaries = [];

    for (const file of files) {
      const content = await readFileContent(file);
      const summary = await sendToGemini(file.name, content);

      fileSummaries.push({ filePath: file.webkitRelativePath, content, geminiSummary: summary });

      setMessages(prev => [...prev, { sender: 'User', text: `What does ${file.name} do?` }, { sender: 'AI', text: summary }]);
    }

    await saveChat(chatId, messages);
  };

  const readFileContent = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  return (
    <div>
      <h2>Repo AI Chat</h2>
      <input type="file" webkitdirectory="true" directory="true" multiple onChange={handleFolderUpload} />
      <div style={{ marginTop: '20px' }}>
        {messages.map((msg, idx) => (
          <div key={idx} style={{ background: msg.sender === 'AI' ? '#eef' : '#ffe', margin: '5px', padding: '10px' }}>
            <strong>{msg.sender}:</strong> {msg.text}
          </div>
        ))}
      </div>
    </div>
  );
};

export default FileProcessor;
