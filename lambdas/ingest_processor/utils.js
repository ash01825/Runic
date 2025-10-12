export function log(message, context = {}) {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...context, message }));
}

export function getCurrentISOTime() {
    return new Date().toISOString();
}