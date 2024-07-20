const socket = io();

const usernameInput = document.getElementById('usernameInput');
const roomInput = document.getElementById('roomInput');
const joinButton = document.getElementById('joinButton');
const currentRoom = document.getElementById('currentRoom');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const userList = document.getElementById('userList');
const debugInfo = document.getElementById('debugInfo');

joinButton.addEventListener('click', joinRoom);
startButton.addEventListener('click', startVoiceChat);
stopButton.addEventListener('click', stopVoiceChat);

let stream;
let audioContext;
let analyser;
let scriptProcessor;
let vadEnabled = false;

// VAD parameters
const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;
const SMOOTHING_TIME_CONSTANT = 0.8;
const ENERGY_THRESHOLD = -45; // in dB
const SPEECH_PADDING = 300; // ms

let lastVoiceDetectTime = 0;
let isCurrentlySpeaking = false;
let currentUserId = null;

function joinRoom() {
    const room = roomInput.value.trim();
    const username = usernameInput.value.trim();
    if (room && username) {
        socket.emit('join room', room, username);
        currentRoom.textContent = room;
        startButton.disabled = false;
        stopButton.disabled = true;
        roomInput.value = '';
        debugLog(`Joining room: ${room} as ${username}`);
    }
}

async function startVoiceChat() {
    try {
        if (!currentUserId) {
            debugLog('Error: User ID not set. Please try rejoining the room.');
            return;
        }

        debugLog('Starting voice chat...');
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };
        debugLog('Requesting microphone access...');
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        debugLog('Microphone access granted.');

        audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
        debugLog(`Audio context created. State: ${audioContext.state}`);

        if (audioContext.state === 'suspended') {
            debugLog('Audio context is suspended. Attempting to resume...');
            await audioContext.resume();
            debugLog(`Audio context resumed. New state: ${audioContext.state}`);
        }

        const source = audioContext.createMediaStreamSource(stream);
        debugLog('Media stream source created.');

        analyser = audioContext.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;
        debugLog('Analyser node created and configured.');

        scriptProcessor = audioContext.createScriptProcessor(1024, 1, 1);
        debugLog('Script processor node created.');

        source.connect(analyser);
        analyser.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination);
        debugLog('Audio nodes connected.');

        scriptProcessor.onaudioprocess = processAudio;
        debugLog('Audio processing function attached.');

        vadEnabled = true;
        startButton.textContent = 'Voice Chat Active';
        startButton.disabled = true;
        stopButton.disabled = false;
        debugLog('Voice chat started successfully.');

    } catch (error) {
        console.error('Error starting voice chat:', error);
        debugLog(`Error starting voice chat: ${error.message}`);
        debugLog('Full error object:', error);
    }
}

function stopVoiceChat() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (audioContext) {
        audioContext.close();
    }
    if (scriptProcessor) {
        scriptProcessor.disconnect();
    }
    vadEnabled = false;
    startButton.textContent = 'Start Voice Chat';
    startButton.disabled = false;
    stopButton.disabled = true;
    debugLog('Voice chat stopped.');
    
    // Leave the room
    socket.emit('leave room');
}

function processAudio(audioProcessingEvent) {
    if (!vadEnabled || !currentUserId) return;

    const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
    const energy = calculateEnergy(inputData);
    const isSpeaking = detectVoiceActivity(energy);

    if (isSpeaking) {
        socket.emit('voice', inputData.buffer);
        debugLog(`Speaking detected. Energy: ${energy.toFixed(2)} dB`);
    }

    updateActivityMeter(currentUserId, energy);
    
    if (isSpeaking !== isCurrentlySpeaking) {
        isCurrentlySpeaking = isSpeaking;
        socket.emit('speaking', { isSpeaking, energy });
        debugLog(`Speaking state changed. Is speaking: ${isSpeaking}`);
    }
}

function calculateEnergy(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sum / buffer.length);
    return 20 * Math.log10(rms);
}

function detectVoiceActivity(energy) {
    const now = Date.now();
    const timeSinceLastDetection = now - lastVoiceDetectTime;

    if (energy > ENERGY_THRESHOLD) {
        lastVoiceDetectTime = now;
        return true;
    } else if (timeSinceLastDetection < SPEECH_PADDING) {
        return true;
    }

    return false;
}

function updateActivityMeter(userId, energy) {
    if (!userId) {
        debugLog('Error: Attempted to update meter with undefined user ID');
        return;
    }

    const meterElement = document.getElementById(`meter-${userId}`);
    if (meterElement) {
        const normalizedEnergy = Math.max(0, Math.min(100, (energy + 60) * 2.5));
        meterElement.style.width = `${normalizedEnergy}%`;
        meterElement.style.backgroundColor = getColorForEnergy(normalizedEnergy);
        debugLog(`Updating meter for user ${userId}. Energy: ${energy.toFixed(2)} dB, Normalized: ${normalizedEnergy.toFixed(2)}%`);
    } else {
        debugLog(`Meter element not found for user ${userId}`);
    }
}

function getColorForEnergy(energy) {
    if (energy < 30) return '#00ff00';
    if (energy < 70) return '#ffff00';
    return '#ff0000';
}

function updateUserList(users) {
    userList.innerHTML = '';
    users.forEach(([id, user]) => addUserToList({ id, ...user }));
}

function addUserToList({ id, username }) {
    const li = document.createElement('li');
    li.id = `user-${id}`;
    li.className = 'user-item';
    li.innerHTML = `
        <span>${username}</span>
        <div class="meter-container">
            <div id="meter-${id}" class="meter"></div>
        </div>
    `;
    userList.appendChild(li);
    debugLog(`Added user to list: ${username} (ID: ${id})`);
}

function removeUserFromList(userId) {
    const userElement = document.getElementById(`user-${userId}`);
    if (userElement) {
        userElement.remove();
        debugLog(`Removed user from list: ${userId}`);
    }
}

function debugLog(message) {
    console.log(message);
    const logEntry = document.createElement('p');
    logEntry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
    debugInfo.appendChild(logEntry);
    debugInfo.scrollTop = debugInfo.scrollHeight;
}

// Socket event listeners
socket.on('connect', () => {
    debugLog(`Socket connected. Socket ID: ${socket.id}`);
    startButton.disabled = true;
    stopButton.disabled = true;
});

socket.on('room users', (users) => {
    updateUserList(users);
    debugLog(`Updated user list. Users in room: ${users.length}`);
});

socket.on('user joined', (user) => {
    addUserToList(user);
    debugLog(`User joined: ${user.username} (ID: ${user.id})`);
});

socket.on('user left', (userId) => {
    removeUserFromList(userId);
    debugLog(`User left: ${userId}`);
});

socket.on('your id', (id) => {
    currentUserId = id;
    debugLog(`Received user ID: ${id}`);
});

socket.on('user speaking', ({ id, isSpeaking, energy }) => {
    updateActivityMeter(id, energy);
    debugLog(`User ${id} speaking status: ${isSpeaking}, Energy: ${energy.toFixed(2)} dB`);
});

socket.on('room left', () => {
    currentRoom.textContent = 'None';
    userList.innerHTML = '';
    debugLog('Left the room.');
});

let audioQueue = [];
let isPlaying = false;

socket.on('voice', ({ id, data }) => {
    if (audioContext && audioContext.state === 'running') {
        const audioData = {
            id: id,
            buffer: new Float32Array(data)
        };
        audioQueue.push(audioData);
        if (!isPlaying) {
            playNextAudio();
        }
    }
});

function playNextAudio() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        return;
    }

    isPlaying = true;
    const audioData = audioQueue.shift();
    const buf = audioContext.createBuffer(1, audioData.buffer.length, audioContext.sampleRate);
    buf.getChannelData(0).set(audioData.buffer);
    const source = audioContext.createBufferSource();
    source.buffer = buf;
    source.connect(audioContext.destination);
    source.onended = playNextAudio;
    source.start(0);
}