const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const voiceToggle = document.getElementById('voiceMode');

function scrollToBottom() {
  chat.scrollTop = chat.scrollHeight;
}

function addMessage(role, text) {
  const msg = document.createElement('div');
  msg.classList.add('message', role);
  msg.textContent = (role === 'user' ? 'You: ' : 'Ellie: ') + text;
  chat.appendChild(msg);
  scrollToBottom();
}

async function sendMessage(message) {
  addMessage('user', message);
  input.value = '';
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    const data = await res.json();
    const reply = data.reply;
    addMessage('ellie', reply);
    speak(reply);
  } catch (err) {
    addMessage('ellie', "Something went wrong 😢");
    console.error(err);
  }
}

sendBtn.addEventListener('click', () => {
  const msg = input.value.trim();
  if (msg) sendMessage(msg);
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendBtn.click();
});

micBtn.addEventListener('click', () => {
  if (!('webkitSpeechRecognition' in window)) {
    alert("Voice recognition not supported in this browser.");
    return;
  }

  const recognition = new webkitSpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    sendMessage(transcript);
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error", event.error);
  };

  recognition.start();
});

function speak(text) {
  if (!voiceToggle.checked || !('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 1;
  utterance.pitch = 1.1;
  speechSynthesis.speak(utterance);
}
