/* ── State ──────────────────────────────────────────────────────── */
let sessionId     = null
let socket        = null
let mediaRecorder = null
let audioChunks   = []
let isRecording   = false
let isBotSpeaking = false
let selectedRole  = 'teacher'

/* ── DOM refs ───────────────────────────────────────────────────── */
const statusPill  = document.getElementById('statusPill')
const statusDot   = document.getElementById('statusDot')
const statusText  = document.getElementById('statusText')
const micBtn      = document.getElementById('micBtn')
const micLabel    = document.getElementById('micLabel')
const orb         = document.getElementById('orb')
const roleGrid    = document.getElementById('roleGrid')
const transcript  = document.getElementById('transcript')
const clearBtn    = document.getElementById('clearBtn')

/* ── Init ───────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  await loadRoles()
  micBtn.addEventListener('click', onMicClick)
  clearBtn.addEventListener('click', () => {
    transcript.innerHTML = '<div class="transcript-empty">Conversation will appear here...</div>'
  })
})

/* ── Load roles from backend ─────────────────────────────────────── */
async function loadRoles() {
  try {
    const res   = await fetch('/roles')
    const roles = await res.json()

    roleGrid.innerHTML = ''
    roles.forEach(role => {
      const card = document.createElement('div')
      card.className = 'role-card' + (role.key === selectedRole ? ' active' : '')
      card.innerHTML = `
        <div class="role-card-name">${role.name}</div>
        <div class="role-card-desc">${role.description}</div>
      `
      card.addEventListener('click', () => selectRole(role.key, card))
      roleGrid.appendChild(card)
    })
  } catch (e) {
    console.error('Failed to load roles:', e)
  }
}

function selectRole(key, card) {
  if (sessionId) return // can't change role mid-session
  selectedRole = key
  document.querySelectorAll('.role-card').forEach(c => c.classList.remove('active'))
  card.classList.add('active')
}

/* ── Mic button click ───────────────────────────────────────────── */
async function onMicClick() {
  if (!sessionId) {
    await startSession()
  } else if (isRecording) {
    stopRecording()
  } else if (!isBotSpeaking) {
    startRecording()
  }
}

/* ── Session ────────────────────────────────────────────────────── */
async function startSession() {
  try {
    // Create session on backend
    const res  = await fetch(`/session?role=${selectedRole}`, { method: 'POST' })
    const data = await res.json()
    sessionId  = data.session_id

    // Open WebSocket
    const wsUrl = `ws://${location.host}/ws/${sessionId}`
    socket = new WebSocket(wsUrl)
    socket.binaryType = 'arraybuffer'

    socket.onopen    = () => setStatus('ready', 'ready')
    socket.onmessage = onSocketMessage
    socket.onclose   = () => endSession()
    socket.onerror   = () => setStatus('error', 'connection error')

    // Lock role cards
    document.querySelectorAll('.role-card').forEach(c => c.style.opacity = '0.5')

    micBtn.classList.remove('muted')
    micLabel.textContent = 'Hold to speak'
    micBtn.disabled = false

    setStatus('ready', 'ready')
  } catch (e) {
    setStatus('error', 'failed to connect')
    console.error(e)
  }
}

function endSession() {
  sessionId     = null
  socket        = null
  isRecording   = false
  isBotSpeaking = false

  micBtn.disabled = false
  micLabel.textContent = 'Start session'
  micBtn.classList.remove('recording', 'muted')
  setStatus('disconnected', 'disconnected')
  setOrb('')

  document.querySelectorAll('.role-card').forEach(c => c.style.opacity = '1')
}

/* ── Recording ──────────────────────────────────────────────────── */
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioChunks  = []
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data)
    }

    mediaRecorder.onstop = async () => {
      const blob       = new Blob(audioChunks, { type: 'audio/webm' })
      const arrayBuf   = await blob.arrayBuffer()
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(arrayBuf)
      }
      // Stop all mic tracks
      stream.getTracks().forEach(t => t.stop())
    }

    mediaRecorder.start()
    isRecording = true
    setStatus('listening', 'listening')
    setOrb('listening')
    micBtn.classList.add('recording')
    micLabel.textContent = 'Click to send'
    micBtn.disabled = false

  } catch (e) {
    setStatus('error', 'mic access denied')
    console.error(e)
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop()
    isRecording = false
    micBtn.classList.remove('recording')
    micBtn.classList.add('muted')
    micBtn.disabled = true
    micLabel.textContent = 'Processing...'
    setStatus('thinking', 'processing')
    setOrb('thinking')
  }
}

/* ── WebSocket messages ─────────────────────────────────────────── */
function onSocketMessage(event) {
  // Binary = MP3 audio from TTS
  if (event.data instanceof ArrayBuffer) {
    playAudio(event.data)
    return
  }

  // Text = JSON status/transcript
  try {
    const msg = JSON.parse(event.data)

    if (msg.type === 'status') {
      handleStatus(msg.value)
    }

    if (msg.type === 'transcript') {
      addMessage(msg.role === 'user' ? 'user' : 'bot',
                 msg.role === 'user' ? 'You' : 'Bot',
                 msg.text)
    }

    if (msg.type === 'error') {
      setStatus('error', 'error')
      setOrb('')
      micBtn.disabled = false
      micLabel.textContent = 'Click to speak'
      micBtn.classList.remove('recording', 'muted')
      console.error('Bot error:', msg.message)
    }

  } catch (e) {
    console.error('Failed to parse message:', e)
  }
}

function handleStatus(value) {
  switch (value) {
    case 'ready':
      setStatus('ready', 'ready')
      setOrb('')
      isBotSpeaking = false
      micBtn.disabled = false
      micBtn.classList.remove('recording', 'muted')
      micLabel.textContent = 'Click to speak'
      break
    case 'transcribing':
      setStatus('thinking', 'transcribing')
      setOrb('thinking')
      break
    case 'thinking':
      setStatus('thinking', 'thinking')
      setOrb('thinking')
      break
    case 'speaking':
      setStatus('speaking', 'speaking')
      setOrb('speaking')
      isBotSpeaking = true
      micBtn.disabled = true
      micLabel.textContent = 'Bot speaking...'
      break
  }
}

/* ── Play TTS audio ─────────────────────────────────────────────── */
function playAudio(arrayBuffer) {
  const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
  const url  = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.play()
  audio.onended = () => {
    URL.revokeObjectURL(url)
  }
}

/* ── Transcript ─────────────────────────────────────────────────── */
function addMessage(type, label, text) {
  // Remove empty state
  const empty = transcript.querySelector('.transcript-empty')
  if (empty) empty.remove()

  const msg = document.createElement('div')
  msg.className = `msg ${type}`
  msg.innerHTML = `
    <div class="msg-label">${label}</div>
    <div class="msg-text">${text}</div>
  `
  transcript.appendChild(msg)
  transcript.scrollTop = transcript.scrollHeight
}

/* ── UI helpers ─────────────────────────────────────────────────── */
function setStatus(cls, text) {
  statusPill.className = `status-pill ${cls}`
  statusText.textContent = text
}

function setOrb(state) {
  orb.className = 'orb' + (state ? ` ${state}` : '')
}

/* ── Enable mic button once page loads ──────────────────────────── */
micBtn.disabled = false