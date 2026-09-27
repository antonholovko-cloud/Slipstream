const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'overlay:init', 'overlay:getBounds',
  'settings:get', 'settings:setOverlay', 'settings:resetOverlay', 'settings:setGlobal', 'settings:setEditMode', 'settings:setHidden',
  'settings:profile', 'settings:forgetTrack', 'settings:displays',
]);
const SEND = new Set(['overlay:setBounds']);
const ON = new Set(['overlay:config', 'overlay:state', 'settings:config', 'settings:status']);

contextBridge.exposeInMainWorld('api', {
  invoke: (ch, ...args) => (INVOKE.has(ch) ? ipcRenderer.invoke(ch, ...args) : Promise.reject(new Error('blocked channel ' + ch))),
  send: (ch, ...args) => { if (SEND.has(ch)) ipcRenderer.send(ch, ...args); },
  on: (ch, cb) => {
    if (!ON.has(ch)) return () => {};
    const h = (_e, data) => cb(data);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
});
