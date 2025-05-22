export const sendToGemini = async (fileName, content) => {
  const apiKey = 'AIzaSyAqRtjEVwJi_2pWr4_H33-sdHi5fgs-LmM'; // Replace securely later
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Analyze this file named ${fileName} and summarize it:\n\n${content}` }] }]
    })
  });

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
};