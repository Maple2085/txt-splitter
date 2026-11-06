// 用最小 DOM 桩复刻 showToast / removeToast，验证第 4 条 Toast 是否死循环
class El {
  constructor(){ this.children=[]; this.classList={add:()=>{}}; this.parentNode=null; }
  appendChild(c){ c.parentNode=this; this.children.push(c); }
  removeChild(c){ this.children=this.children.filter(x=>x!==c); c.parentNode=null; }
  get firstElementChild(){ return this.children[0]; }
  setAttribute(){} append(){}
}
const container = new El();
const MAX_TOASTS = 3;
function removeToast(toast) {
  if (toast._exitTimer) clearTimeout(toast._exitTimer);
  toast.classList.add('toast-exit');
  toast._exitTimer = setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
}
let guard = 0;
function showToast(message) {
  while (container.children.length >= MAX_TOASTS) {
    if (++guard > 1000) { throw new Error('死循环：while 条件永远为真（removeToast 只是延迟 300ms 移除，children.length 不变）'); }
    removeToast(container.firstElementChild);
  }
  const toast = new El();
  container.appendChild(toast);
  toast._dismissTimer = setTimeout(() => removeToast(toast), 3500);
}
try {
  showToast('1'); showToast('2'); showToast('3');
  console.log('前 3 条正常, children =', container.children.length);
  showToast('4');
  console.log('第 4 条正常');
} catch (e) { console.log('第 4 条 Toast:', e.message); }
process.exit(0);
