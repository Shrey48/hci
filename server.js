const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'harmonia-secret-key-123'; // In prod, use environment variable
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID'; // Replace with your ID
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Database Setup
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            password TEXT,
            name TEXT,
            data TEXT,
            google_id TEXT
        )`);

        db.run(`ALTER TABLE users ADD COLUMN google_id TEXT`, (err) => { });

        db.run(`CREATE TABLE IF NOT EXISTS concerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            city TEXT,
            title TEXT,
            date TEXT,
            venue TEXT,
            price REAL,
            user_id INTEGER
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            concert_id INTEGER,
            user_id INTEGER,
            qr_code TEXT
        )`, () => {
            // Seed sample concerts if table is empty
            db.get('SELECT COUNT(*) as count FROM concerts', (err, row) => {
                if (!err && row && row.count === 0) {
                    const sampleConcerts = [
                        ['Mumbai', 'Arijit Singh Live in Concert', '2026-04-15 7:00 PM', 'NSCI Dome', 2500],
                        ['Delhi', 'AR Rahman World Tour 2026', '2026-04-22 6:30 PM', 'Jawaharlal Nehru Stadium', 3000],
                        ['Bangalore', 'Indie Music Festival', '2026-05-01 4:00 PM', 'Palace Grounds', 1500],
                        ['Hyderabad', 'Prateek Kuhad Acoustic Night', '2026-05-10 8:00 PM', 'Shilpakala Vedika', 1200],
                        ['Chennai', 'Carnatic Fusion Night', '2026-05-18 7:00 PM', 'Music Academy', 800],
                        ['Pune', 'Nucleya Bass Drop Tour', '2026-04-28 9:00 PM', 'Mahalaxmi Lawns', 1800],
                        ['Mumbai', 'The Local Train — Farewell Tour', '2026-06-05 6:00 PM', 'Jio Garden', 2000],
                        ['Delhi', 'Anuv Jain Live Under the Stars', '2026-06-12 7:30 PM', 'Select City Walk Amphitheater', 1400],
                        ['Kolkata', 'Bengali Rock Night', '2026-05-25 7:00 PM', 'Rabindra Sadan', 600],
                        ['Goa', 'Sunburn Music Festival 2026', '2026-12-28 2:00 PM', 'Vagator Beach', 5000],
                    ];
                    const stmt = db.prepare('INSERT INTO concerts (city, title, date, venue, price, user_id) VALUES (?, ?, ?, ?, ?, 0)');
                    sampleConcerts.forEach(c => stmt.run(c));
                    stmt.finalize();
                    console.log('Seeded 10 sample concerts.');
                }
            });
        });
    }
});

// Auth middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// ── AUTH ROUTES ──

// 1. Signup
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, password, data } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (email, password, name, data) VALUES (?, ?, ?, ?)',
            [email.toLowerCase(), hashedPassword, name, JSON.stringify(data || {})],
            function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(409).json({ error: 'Email already exists' });
                    }
                    return res.status(500).json({ error: err.message });
                }
                const token = jwt.sign({ id: this.lastID, email }, JWT_SECRET, { expiresIn: '7d' });
                res.status(201).json({ token });
            }
        );
    } catch (err) {
        res.status(500).json({ error: 'Error processing request' });
    }
});

// 2. Login
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'User not found' });
        const match = await bcrypt.compare(password, row.password);
        if (!match) return res.status(401).json({ error: 'Incorrect password' });
        const token = jwt.sign({ id: row.id, email: row.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, data: JSON.parse(row.data) });
    });
});

// 3. Google OAuth
app.post('/api/auth/google', async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing credential' });

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { sub: googleId, email, name, picture } = payload;

        // Check if user exists
        db.get('SELECT * FROM users WHERE email = ? OR google_id = ?', [email, googleId], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            if (row) {
                // Existing user — update google_id if needed and login
                if (!row.google_id) {
                    db.run('UPDATE users SET google_id = ? WHERE id = ?', [googleId, row.id]);
                }
                const token = jwt.sign({ id: row.id, email: row.email }, JWT_SECRET, { expiresIn: '7d' });
                const userData = JSON.parse(row.data || '{}');
                userData.name = userData.name || name;
                userData.avatar = picture;
                res.json({ token, data: userData, name: row.name || name });
            } else {
                // New user — auto-create
                const newUserData = JSON.stringify({
                    name, email, avatar: picture,
                    level: 1, xp: 0, totalPracticeTime: 0,
                    achievements: [], activities: [], generatedTracks: [],
                    instruments: { piano: { level: 'Beginner', progress: 0 }, guitar: { level: 'Beginner', progress: 0 } }
                });
                db.run('INSERT INTO users (email, password, name, data, google_id) VALUES (?, ?, ?, ?, ?)',
                    [email, '', name, newUserData, googleId],
                    function (err) {
                        if (err) return res.status(500).json({ error: err.message });
                        const token = jwt.sign({ id: this.lastID, email }, JWT_SECRET, { expiresIn: '7d' });
                        res.status(201).json({ token, data: JSON.parse(newUserData), name });
                    }
                );
            }
        });
    } catch (err) {
        console.error('Google OAuth error:', err);
        res.status(401).json({ error: 'Invalid Google credential' });
    }
});

// ── USER DATA ROUTES ──

app.get('/api/user', authenticateToken, (req, res) => {
    db.get('SELECT data FROM users WHERE id = ?', [req.user.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'User not found' });
        res.json(JSON.parse(row.data));
    });
});

app.put('/api/user', authenticateToken, (req, res) => {
    const data = JSON.stringify(req.body);
    db.run('UPDATE users SET data = ? WHERE id = ?', [data, req.user.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'User data updated successfully' });
    });
});

// ── AI MUSIC GENERATION ──
// Returns a procedurally generated note sequence based on parameters

const SCALES = {
    'C Major': [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25],
    'G Major': [392.00, 440.00, 493.88, 523.25, 587.33, 659.25, 739.99, 783.99],
    'D Minor': [293.66, 329.63, 349.23, 392.00, 440.00, 466.16, 523.25, 587.33],
    'A Minor': [220.00, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00, 440.00],
    'F Major': [349.23, 392.00, 440.00, 466.16, 523.25, 587.33, 659.25, 698.46],
    'E Minor': [329.63, 369.99, 392.00, 440.00, 493.88, 523.25, 587.33, 659.25],
};

const WAVE_TYPES = {
    'Lo-fi': 'sine', 'Jazz': 'triangle', 'Classical': 'sine',
    'Electronic': 'square', 'Folk': 'triangle', 'Pop': 'sine', 'Rock': 'sawtooth',
};

function generateNoteSequence(genre, mood, tempo, key) {
    const scale = SCALES[key] || SCALES['C Major'];
    const waveType = WAVE_TYPES[genre] || 'sine';
    const bpm = parseInt(tempo) || 90;
    const beatDuration = 60 / bpm;
    const noteCount = 16 + Math.floor(Math.random() * 16); // 16-32 notes
    const notes = [];

    // Mood affects note selection pattern
    const moodWeights = {
        'Calm': { rest: 0.2, longNote: 0.4, stepSize: 1 },
        'Energetic': { rest: 0.05, longNote: 0.1, stepSize: 2 },
        'Melancholic': { rest: 0.25, longNote: 0.5, stepSize: 1 },
        'Happy': { rest: 0.1, longNote: 0.2, stepSize: 2 },
        'Mysterious': { rest: 0.3, longNote: 0.3, stepSize: 3 },
        'Romantic': { rest: 0.15, longNote: 0.45, stepSize: 1 },
    };
    const w = moodWeights[mood] || moodWeights['Calm'];

    let currentIdx = Math.floor(Math.random() * scale.length);
    for (let i = 0; i < noteCount; i++) {
        if (Math.random() < w.rest) {
            // Rest
            notes.push({ freq: 0, duration: beatDuration * (Math.random() < 0.5 ? 0.5 : 1), type: waveType });
        } else {
            // Step through scale
            const step = Math.floor(Math.random() * w.stepSize * 2) - w.stepSize;
            currentIdx = Math.max(0, Math.min(scale.length - 1, currentIdx + step));
            const duration = Math.random() < w.longNote
                ? beatDuration * (1 + Math.random())
                : beatDuration * (0.25 + Math.random() * 0.5);
            // Occasionally use lower octave
            const octaveShift = Math.random() < 0.15 ? 0.5 : 1;
            notes.push({ freq: scale[currentIdx] * octaveShift, duration, type: waveType });
        }
    }

    // Add bass line (every 4 beats)
    const bassNotes = [];
    for (let i = 0; i < Math.ceil(noteCount / 4); i++) {
        const bassIdx = Math.floor(Math.random() * 3); // root, 3rd, 5th
        bassNotes.push({ freq: scale[bassIdx] / 2, duration: beatDuration * 2, type: 'sine' });
    }

    return { melody: notes, bass: bassNotes, waveType, bpm };
}

// ── PROMPT-AWARE LYRICS GENERATION ──
function generateLyrics(mood, genre, prompt) {
    // Extract meaningful words from the prompt
    const stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','is','it','this','that','from','as','are','was','be','has','had','do','does','my','your','we','i','me','you','he','she','they','our','make','like','want','need','some','get','let','can','will','just']);
    const promptWords = (prompt || '').toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    const theme = promptWords.slice(0, 5).join(' ') || 'music and life';

    // Theme-specific line generators
    const themeLines = {
        love: [
            `Your love is everything I need`, `Hearts beating as one tonight`,
            `Hold me close, never let me go`, `Every whisper tells our story`,
            `In your eyes I see forever`, `Two souls dancing in the moonlight`,
        ],
        night: [
            `The night is alive with sound`, `Stars are falling all around`,
            `Midnight dreams and neon lights`, `Dancing through the endless night`,
            `The city sleeps but we're awake`, `Under moonlit sky we break`,
        ],
        rain: [
            `Rain falls like a symphony`, `Drops of silver melody`,
            `Washing away yesterday's pain`, `Dancing barefoot in the rain`,
            `Thunder echoes what I feel`, `Every raindrop makes it real`,
        ],
        summer: [
            `Golden sun on my skin`, `Summer breeze, let it begin`,
            `Endless days of warmth and light`, `Beach waves crashing left and right`,
            `Ice cream dreams and salty air`, `Freedom floating everywhere`,
        ],
        dream: [
            `Lost in a dream I never want to end`, `Fantasy and reality blend`,
            `Floating through a world of light`, `Everything feels so right`,
            `Close my eyes and start to fly`, `Touching colors in the sky`,
        ],
        dance: [
            `Move your body to the beat`, `Feel the rhythm in your feet`,
            `The floor is ours tonight`, `Spinning under flashing lights`,
            `Let the music take control`, `Dancing deep into your soul`,
        ],
        sad: [
            `Tears fall like autumn leaves`, `My heart breaks but still believes`,
            `Empty rooms and silent phones`, `Walking through this world alone`,
            `Missing everything we had`, `Memories that make me sad`,
        ],
        party: [
            `Turn it up and let it go`, `Feel the bass drop down below`,
            `Hands up, reaching for the sky`, `Tonight we're gonna fly so high`,
            `The crowd goes wild, can you feel it`, `This moment is ours to live it`,
        ],
    };

    // Match prompt to themes
    const themeMap = {
        love: ['love','heart','romance','kiss','darling','baby','together','crush','passion','affection'],
        night: ['night','dark','moon','midnight','stars','evening','late','neon','city'],
        rain: ['rain','storm','thunder','drops','wet','umbrella','clouds','weather'],
        summer: ['summer','sun','beach','hot','warm','vacation','sea','ocean','sand'],
        dream: ['dream','sleep','imagine','fantasy','wonder','float','fly','cloud'],
        dance: ['dance','move','groove','rhythm','beat','club','floor','step','vibe'],
        sad: ['sad','cry','miss','alone','broken','lost','pain','tears','gone','goodbye'],
        party: ['party','celebrate','fun','wild','crazy','tonight','turn','lit','fire','hype'],
    };

    let matchedThemes = [];
    for (const [th, keywords] of Object.entries(themeMap)) {
        if (promptWords.some(w => keywords.includes(w))) matchedThemes.push(th);
    }
    if (matchedThemes.length === 0) matchedThemes = ['dream'];

    // Mood-based filler lines
    const moodLines = {
        'Calm': ['Peaceful moments drift on by', 'The world stands still in gentle time', 'Breathe in deep and let it flow', 'Quiet whispers soft and low'],
        'Energetic': ['We own the night, we own the stage', 'Breaking free from every cage', 'Running fast, no looking back', 'On fire, there\'s no turning back'],
        'Melancholic': ['Shadows fall on empty streets', 'Memories play on repeat', 'Time moves slow when you\'re away', 'I still remember every day'],
        'Happy': ['Sunshine breaking through the grey', 'Every moment feels like play', 'Laughter echoes all around', 'Joy in every sight and sound'],
        'Mysterious': ['Secrets hidden in the dark', 'Every shadow leaves its mark', 'The unknown is calling me', 'Into mysteries, I\'m set free'],
        'Romantic': ['Your smile lights up my world', 'In your arms, I come unfurled', 'Love is written in the stars', 'You\'re the one who heals my scars'],
    };

    const fillers = moodLines[mood] || moodLines['Calm'];
    const themed = matchedThemes.flatMap(t => themeLines[t] || []);
    const allLines = [...themed, ...fillers].sort(() => Math.random() - 0.5);

    // Create prompt-specific chorus line
    const chorusKeyword = promptWords[0] || 'music';
    const chorusTemplates = [
        `Oh, ${chorusKeyword}, you're all I need tonight`,
        `${chorusKeyword.charAt(0).toUpperCase() + chorusKeyword.slice(1)}, take me higher, take me far`,
        `Living for the ${chorusKeyword}, living for the sound`,
        `Every ${chorusKeyword} brings me back to life`,
    ];
    const chorusLine1 = chorusTemplates[Math.floor(Math.random() * chorusTemplates.length)];
    const chorusLine2 = allLines[0] || 'Feel the music in your soul';

    const verse1 = allLines.slice(1, 5).join('\n');
    const verse2 = allLines.slice(5, 9).length >= 4 ? allLines.slice(5, 9).join('\n') : allLines.slice(1, 5).sort(() => Math.random() - 0.5).join('\n');
    const chorus = `${chorusLine1}\n${chorusLine2}\n${allLines[allLines.length - 1] || 'Let the music set you free'}\nYeah, ${chorusKeyword}, this is where we belong`;
    const bridge = `(Bridge)\n${themed[themed.length - 1] || 'Close your eyes and feel the sound'}\n${fillers[fillers.length - 1] || 'Everything comes back around'}`;

    return `[Verse 1]\n${verse1}\n\n[Chorus]\n${chorus}\n\n[Verse 2]\n${verse2}\n\n[Chorus]\n${chorus}\n\n${bridge}\n\n[Outro]\n${chorusLine1}\n${chorusKeyword.charAt(0).toUpperCase() + chorusKeyword.slice(1)}... (fade out)`;
}

app.post('/api/music/generate', async (req, res) => {
    const { prompt, genre, mood, tempo, key, withLyrics } = req.body;

    const words = (prompt || '').split(' ').filter(w => w.length > 3);
    const pick = (words.length > 0 ? words[Math.floor(Math.random() * words.length)] : 'Untitled').replace(/[^a-zA-Z]/g, '');
    const sfx = ['Dreams', 'Waves', 'Nights', 'Echoes', 'Journey', 'Drift', 'Horizon', 'Aurora'];
    const name = (pick ? pick.charAt(0).toUpperCase() + pick.slice(1) : 'Audio') + ' ' + sfx[Math.floor(Math.random() * sfx.length)];

    const fullPrompt = `${genre || 'Lo-fi'} ${mood || 'calm'} music, ${prompt || 'instrumental'}, ${tempo || 90} BPM`;

    // Try HuggingFace MusicGen API
    let audioBase64 = null;
    let usedAI = false;
    try {
        const hfRes = await fetch('https://api-inference.huggingface.co/models/facebook/musicgen-small', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: fullPrompt }),
            signal: AbortSignal.timeout(30000),
        });
        if (hfRes.ok) {
            const audioBuffer = await hfRes.arrayBuffer();
            audioBase64 = Buffer.from(audioBuffer).toString('base64');
            usedAI = true;
        }
    } catch (err) {
        console.log('HuggingFace API unavailable, using local synthesis:', err.message);
    }

    const sequence = generateNoteSequence(genre, mood, tempo, key || 'C Major');

    const track = {
        id: 'trk_' + Math.random().toString(36).substring(2, 9),
        name,
        prompt,
        genre,
        mood,
        tempo,
        key: key || 'C Major',
        date: new Date().toLocaleDateString(),
        sequence,
        usedAI,
    };

    if (audioBase64) {
        track.audioBase64 = audioBase64;
    }

    if (withLyrics) {
        track.lyrics = generateLyrics(mood, genre, prompt);
    }

    res.json(track);
});

// ── CONCERTS ROUTES ──
app.get('/api/concerts', (req, res) => {
    const { city } = req.query;
    let query = 'SELECT * FROM concerts';
    let params = [];
    if (city) {
        query += ' WHERE LOWER(city) LIKE ?';
        params.push(`%${city.toLowerCase()}%`);
    }
    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ concerts: rows });
    });
});

app.post('/api/concerts', authenticateToken, (req, res) => {
    const { city, title, date, venue, price } = req.body;
    if (!city || !title) return res.status(400).json({ error: 'City and title required' });

    db.run(
        'INSERT INTO concerts (city, title, date, venue, price, user_id) VALUES (?, ?, ?, ?, ?, ?)',
        [city, title, date, venue, price, req.user.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.post('/api/concerts/book', authenticateToken, (req, res) => {
    const { concertId } = req.body;
    if (!concertId) return res.status(400).json({ error: 'Concert ID required' });

    const qrCode = `TK-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    db.run(
        'INSERT INTO tickets (concert_id, user_id, qr_code) VALUES (?, ?, ?)',
        [concertId, req.user.id, qrCode],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, ticketId: this.lastID, qrCode });
        }
    );
});

app.get('/api/users/tickets', authenticateToken, (req, res) => {
    db.all(
        `SELECT tickets.qr_code, tickets.id as ticket_id, concerts.* 
         FROM tickets 
         JOIN concerts ON tickets.concert_id = concerts.id 
         WHERE tickets.user_id = ?`,
        [req.user.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ tickets: rows });
        }
    );
});

// Fallback
app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
