import { openDB } from 'idb';

export const getDB = async () => {
  return openDB('RepoChatDB', 1, {
    upgrade(db) {
      db.createObjectStore('chatHistory', { keyPath: 'chatId' });
    },
  });
};

export const saveChat = async (chatId, messages) => {
  const db = await getDB();
  await db.put('chatHistory', { chatId, messages, createdAt: new Date() });
};

export const loadChat = async (chatId) => {
  const db = await getDB();
  return db.get('chatHistory', chatId);
};