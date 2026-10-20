/**
 * ==============================================================================
 * Minecraft 24/7 AFK Bot
 * Target Server: IQLE.aternos.me:52476
 * ==============================================================================
 * Features:
 *  - 24/7 Automatic connection and reconnection (with throttle protection)
 *  - Active Anti-AFK engine: jumping, arm swings, camera rotation, crouching, micro-steps
 *  - In-game chat commands: !ping, !status, !help
 *  - Built-in HTTP Health Check endpoint for 24/7 cloud hosting & Uptime monitors
 *  - Safe memory & timer management (prevents interval stacking on respawn/reconnect)
 * ==============================================================================
 */

const http = require('http');
const mineflayer = require('mineflayer');

// Configuration settings (can be overridden via environment variables)
const CONFIG = {
    host: process.env.MC_HOST || 'IQLE.aternos.me',
    port: parseInt(process.env.MC_PORT, 10) || 52476,
    username: process.env.MC_USERNAME || 'AFK_Bot_247',
    version: process.env.MC_VERSION || false, // 'false' enables automatic version detection
    reconnectDelayMs: 15000,                  // 15s delay to prevent Aternos connection throttling
    antiAfkIntervalMs: 15000,                 // Execute anti-AFK actions every 15 seconds
    httpPort: parseInt(process.env.PORT, 10) || 3000 // HTTP port for cloud health checks
};

let bot = null;
let antiAfkInterval = null;
let reconnectTimer = null;
let isReconnecting = false;
let connectionCount = 0;
let botStatus = 'Initializing...';

/**
 * Formatted console logger with timestamps
 */
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${timestamp}] [${level}] ${message}`);
}

/**
 * Starts the Anti-AFK behavior loop
 */
function startAntiAfk() {
    stopAntiAfk();
    log('Anti-AFK engine started. Bot will perform continuous anti-AFK actions.', 'INFO');

    antiAfkInterval = setInterval(() => {
        if (!bot || !bot.entity) return;

        try {
            // 1. Random camera look rotation (yaw and pitch)
            const randomYaw = (Math.random() * 360 - 180) * (Math.PI / 180);
            const randomPitch = (Math.random() * 50 - 25) * (Math.PI / 180);
            bot.look(randomYaw, randomPitch, true).catch(() => {});

            // 2. Jump briefly
            bot.setControlState('jump', true);
            setTimeout(() => {
                if (bot) bot.setControlState('jump', false);
            }, 350);

            // 3. Swing arm
            bot.swingArm('right');

            // 4. Random crouch / sneak
            if (Math.random() > 0.5) {
                bot.setControlState('sneak', true);
                setTimeout(() => {
                    if (bot) bot.setControlState('sneak', false);
                }, 500);
            }

            // 5. Periodic micro-step (forward and backward) to trigger movement detection
            if (Math.random() > 0.6) {
                bot.setControlState('forward', true);
                setTimeout(() => {
                    if (bot) {
                        bot.setControlState('forward', false);
                        bot.setControlState('back', true);
                        setTimeout(() => {
                            if (bot) bot.setControlState('back', false);
                        }, 200);
                    }
                }, 200);
            }
        } catch (err) {
            log(`Anti-AFK execution warning: ${err.message}`, 'WARN');
        }
    }, CONFIG.antiAfkIntervalMs);
}

/**
 * Stops the Anti-AFK loop and resets control states
 */
function stopAntiAfk() {
    if (antiAfkInterval) {
        clearInterval(antiAfkInterval);
        antiAfkInterval = null;
    }
    if (bot) {
        try {
            bot.clearControlStates();
        } catch (e) {
            // Socket may already be closed
        }
    }
}

/**
 * Schedules a single safe reconnection attempt
 */
function scheduleReconnect(customDelayMs = CONFIG.reconnectDelayMs) {
    if (isReconnecting) return;
    isReconnecting = true;
    stopAntiAfk();

    const seconds = Math.round(customDelayMs / 1000);
    log(`Disconnected from server. Reconnecting in ${seconds} seconds...`, 'WARN');
    botStatus = `Reconnecting in ${seconds}s...`;

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        createBot();
    }, customDelayMs);
}

/**
 * Initializes and connects the Mineflayer bot
 */
function createBot() {
    isReconnecting = false;
    connectionCount++;
    botStatus = `Connecting to ${CONFIG.host}:${CONFIG.port}...`;
    log(`Connecting to ${CONFIG.host}:${CONFIG.port} as '${CONFIG.username}' (Attempt #${connectionCount})...`, 'INFO');

    const botOptions = {
        host: CONFIG.host,
        port: CONFIG.port,
        username: CONFIG.username,
        hideErrors: false
    };

    if (CONFIG.version) {
        botOptions.version = CONFIG.version;
    }

    try {
        bot = mineflayer.createBot(botOptions);
    } catch (err) {
        log(`Failed to initialize bot: ${err.message}`, 'ERROR');
        scheduleReconnect();
        return;
    }

    // Triggered when bot enters the server and spawns into the world
    bot.on('spawn', () => {
        botStatus = `Online on ${CONFIG.host}:${CONFIG.port}`;
        const pos = bot.entity ? `[X:${Math.round(bot.entity.position.x)}, Y:${Math.round(bot.entity.position.y)}, Z:${Math.round(bot.entity.position.z)}]` : '[Position unknown]';
        log(`Bot successfully joined and spawned on the server! Location: ${pos}`, 'INFO');

        // Start anti-AFK movements
        startAntiAfk();
    });

    // In-game chat listener
    bot.on('chat', (username, message) => {
        if (username === bot.username) return; // Ignore own messages
        log(`[Chat] <${username}> ${message}`, 'INFO');

        const trimmed = message.trim().toLowerCase();
        if (trimmed === '!ping') {
            bot.chat('Pong! I am online and keeping the server alive 24/7.');
        } else if (trimmed === '!status') {
            const hp = bot.health != null ? Math.round(bot.health) : 'N/A';
            const food = bot.food != null ? Math.round(bot.food) : 'N/A';
            bot.chat(`Status: Online | Health: ${hp}/20 | Food: ${food}/20`);
        } else if (trimmed === '!help') {
            bot.chat('Available commands: !ping (check if bot is alive), !status (view bot health & hunger)');
        }
    });

    // Handle bot death/respawn
    bot.on('death', () => {
        log('Bot died in-game. Respawning automatically...', 'WARN');
        stopAntiAfk();
    });

    // Handle kicked event
    bot.on('kicked', (reason) => {
        let reasonStr = reason;
        try {
            if (typeof reason === 'object') reasonStr = JSON.stringify(reason);
        } catch (e) {
            reasonStr = String(reason);
        }

        log(`Bot was kicked from server. Reason: ${reasonStr}`, 'WARN');
        botStatus = `Kicked: ${reasonStr}`;

        // If throttled by Aternos, use a slightly longer delay
        if (reasonStr && reasonStr.toLowerCase().includes('throttled')) {
            log('Aternos connection throttled detected. Waiting 20 seconds before retry...', 'WARN');
            scheduleReconnect(20000);
        } else {
            scheduleReconnect();
        }
    });

    // Handle network / protocol errors
    bot.on('error', (err) => {
        log(`Bot encountered an error: ${err.message || err}`, 'ERROR');
        botStatus = `Error: ${err.message || err}`;
    });

    // Handle disconnection
    bot.on('end', (reason) => {
        log(`Connection terminated. Reason: ${reason || 'Socket closed'}`, 'WARN');
        scheduleReconnect();
    });
}

// Built-in HTTP Health Check Server
// Essential for cloud hosts (Render, Railway, Koyeb, etc.) to keep the container awake
const server = http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
        status: 'ok',
        service: 'Minecraft 24/7 AFK Bot',
        botStatus: botStatus,
        serverTarget: `${CONFIG.host}:${CONFIG.port}`,
        botUsername: CONFIG.username,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    }, null, 2));
});

server.listen(CONFIG.httpPort, () => {
    log(`HTTP Health Check server is listening on port ${CONFIG.httpPort}`, 'INFO');
});

// Prevent unhandled crashes from killing the background process
process.on('uncaughtException', (err) => {
    log(`Uncaught Exception: ${err.message}`, 'ERROR');
});

process.on('unhandledRejection', (reason) => {
    log(`Unhandled Rejection: ${reason}`, 'ERROR');
});

// Launch the bot
createBot();
