const state = {
  user: null, users: [], docs: [], activeDocs: [], trashDocs: [], activeDoc: null, filter: 'all',
  saveTimer: null, toastTimer: null, isSaving: false, saveAgain: false,
  savePromise: null, pendingConfirm: null, booted: false
};
const $ = (id) => document.getElementById(id);
const api = async (path, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (state.user) headers.set('X-User-Email', state.user);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { const payload = await response.json(); message = payload.detail || message; } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
};
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = (name) => (name || '?').trim().split(/\s+/).slice(0,2).map(p => p[0]).join('').toUpperCase();
const relativeTime = (iso) => {
  if (!iso) return 'Recently';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'Just now';
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric' });
};
function showToast(message, error = false) {
  const el = $('toast'); el.textContent = message; el.classList.toggle('error', error); el.classList.add('show');
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
function setSaveStatus(status, text) {
  const el = $('saveIndicator'); el.classList.toggle('saving', status === 'saving'); el.classList.toggle('error', status === 'error'); $('saveText').textContent = text;
}
function setView(view) { $('welcomeView').classList.toggle('hidden', view !== 'welcome'); $('editorView').classList.toggle('hidden', view !== 'editor'); }
function routeUrl(route) {
  const params = new URLSearchParams();
  if (route.view === 'editor' && route.docId) params.set('doc', route.docId);
  else if (route.filter && route.filter !== 'all') params.set('view', route.filter);
  return `/${params.toString() ? `?${params.toString()}` : ''}`;
}
function writeRoute(route, mode = 'push') {
  const payload = { folio: true, view: route.view || 'home', filter: route.filter || 'all', docId: route.docId || null };
  const url = routeUrl(payload);
  if (mode === 'push') history.pushState(payload, '', url);
  else if (mode === 'replace') history.replaceState(payload, '', url);
}
async function flushPendingSave() {
  if (!state.activeDoc || state.activeDoc.access_role === 'viewer') return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (state.savePromise) await state.savePromise;
  else if ($('saveIndicator').classList.contains('saving')) await saveDocument();
}
function updateBreadcrumb(label) { $('breadcrumbTitle').textContent = label; }
function viewTitle(filter) {
  return ({ all:'All documents', owned:'My documents', shared:'Shared with me', starred:'Starred', trash:'Trash' })[filter] || 'All documents';
}
function visibleDocs() {
  const q = $('searchInput').value.trim().toLowerCase();
  return state.docs.filter(d => {
    const filterMatch = state.filter === 'all' || state.filter === 'trash' ||
      (state.filter === 'owned' && d.is_owner) || (state.filter === 'shared' && !d.is_owner) ||
      (state.filter === 'starred' && d.is_favorite);
    return filterMatch && (!q || `${d.title} ${d.preview || ''}`.toLowerCase().includes(q));
  });
}
function cardActions(doc) {
  if (state.filter === 'trash') {
    return `<div class="card-actions"><button class="card-action" data-card-action="restore" data-id="${escapeHTML(doc.id)}" title="Restore document" aria-label="Restore document">↶</button><button class="card-action danger-text" data-card-action="permanent" data-id="${escapeHTML(doc.id)}" title="Delete permanently" aria-label="Delete permanently">×</button></div>`;
  }
  const ownerActions = doc.is_owner ? `<button data-card-action="rename" data-id="${escapeHTML(doc.id)}">✎ Rename</button><button class="danger-action" data-card-action="trash" data-id="${escapeHTML(doc.id)}">♲ Move to trash</button>` : '';
  return `<div class="card-actions"><button class="card-action ${doc.is_favorite ? 'is-favorite' : ''}" data-card-action="favorite" data-id="${escapeHTML(doc.id)}" title="${doc.is_favorite ? 'Remove from starred' : 'Add to starred'}" aria-label="Toggle star">${doc.is_favorite ? '★' : '☆'}</button><div class="menu-anchor"><button class="card-action" data-card-action="menu" data-id="${escapeHTML(doc.id)}" title="More actions" aria-label="More document actions">•••</button><div class="action-menu card-action-menu hidden" id="menu-${escapeHTML(doc.id)}">${ownerActions}<button data-card-action="duplicate" data-id="${escapeHTML(doc.id)}">▣ Make a copy</button></div></div></div>`;
}
function renderDocs() {
  const filtered = visibleDocs();
  $('allCount').textContent = state.activeDocs.length;
  $('trashCount').textContent = state.trashDocs.length;
  $('listHeading').textContent = viewTitle(state.filter) === 'All documents' ? 'Your documents' : viewTitle(state.filter);
  $('listSubheading').textContent = state.filter === 'trash' ? 'Items in trash can be restored or permanently deleted.' : state.filter === 'starred' ? 'Your most important documents, all in one place.' : 'Pick up where you left off.';
  $('searchInput').placeholder = state.filter === 'trash' ? 'Search trash' : 'Search documents';
  $('documentGrid').innerHTML = filtered.length ? filtered.map(doc => `
    <article class="document-card ${state.filter === 'trash' ? 'trashed-card' : ''}" data-id="${escapeHTML(doc.id)}" tabindex="0" role="button" aria-label="${state.filter === 'trash' ? 'Trashed' : 'Open'} ${escapeHTML(doc.title)}">
      <div class="card-top"><div class="doc-type-icon ${doc.is_owner ? '' : 'shared'}">${state.filter === 'trash' ? '♲' : doc.is_owner ? '▤' : '⇄'}</div><span class="card-badge ${doc.is_owner ? '' : 'shared'}">${state.filter === 'trash' ? 'IN TRASH' : doc.is_owner ? 'OWNED' : 'SHARED'}</span>${cardActions(doc)}</div>
      <h3>${escapeHTML(doc.title)}</h3><p>${state.filter === 'trash' ? `Deleted ${relativeTime(doc.trashed_at)}` : doc.is_owner ? 'Your document' : `Shared by ${escapeHTML(doc.owner.name)}`}</p>${state.filter === 'trash' ? '' : `<p class="card-preview">${escapeHTML(doc.preview || 'No content yet. Open to start writing.')}</p>`}
      <div class="card-foot"><span class="card-owner"><span class="mini-avatar">${escapeHTML(initials(doc.owner.name))}</span>${escapeHTML(doc.owner.name)}</span><span>${relativeTime(doc.updated_at)}</span></div>
    </article>`).join('') : `<div class="empty-state"><div class="empty-illustration">${state.filter === 'trash' ? '♲' : state.filter === 'starred' ? '☆' : '✧'}</div><strong>${state.filter === 'trash' ? 'Your trash is empty' : state.filter === 'shared' ? 'Nothing shared with you yet' : state.filter === 'starred' ? 'No starred documents yet' : 'A fresh page awaits.'}</strong><span>${state.filter === 'trash' ? 'Deleted documents will stay here until you restore or permanently delete them.' : state.filter === 'shared' ? 'Ask a teammate to share a document with you.' : state.filter === 'starred' ? 'Star a document to keep it close at hand.' : 'Create a document or import an existing file to begin.'}</span></div>`;
  const recent = state.activeDocs.slice(0,5);
  $('sidebarRecent').innerHTML = recent.map(d => `<button class="recent-item" data-id="${escapeHTML(d.id)}">▤ &nbsp;${escapeHTML(d.title)}</button>`).join('') || '<div class="sidebar-empty">Your documents will appear here.</div>';
  document.querySelectorAll('[data-filter]').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === state.filter));
}
async function loadDocs() {
  const [active, trash] = await Promise.all([api('/api/documents'), api('/api/trash')]);
  state.activeDocs = active; state.trashDocs = trash;
  state.docs = state.filter === 'trash' ? trash : active;
  renderDocs();
}
async function openDocument(id, { historyMode = 'push' } = {}) {
  try {
    if (state.activeDoc && state.activeDoc.id !== id) await flushPendingSave();
    const doc = await api(`/api/documents/${encodeURIComponent(id)}`);
    const isNewRoute = state.activeDoc?.id !== id;
    state.activeDoc = doc;
    $('documentTitle').value = doc.title;
    $('editor').innerHTML = doc.content_html || '<p><br></p>';
    $('docMetaText').textContent = doc.is_owner ? 'Owned by you' : `Shared by ${doc.owner.name}`;
    $('updatedMeta').textContent = relativeTime(doc.updated_at);
    $('readOnlyTag').classList.toggle('hidden', doc.access_role !== 'viewer');
    $('documentTitle').disabled = doc.access_role === 'viewer';
    $('editor').contentEditable = String(doc.access_role !== 'viewer');
    $('formatSelect').disabled = doc.access_role === 'viewer';
    $('fontSizeSelect').disabled = doc.access_role === 'viewer';
    $('toolbar').querySelectorAll('button').forEach(b => b.disabled = doc.access_role === 'viewer');
    $('shareBtn').classList.toggle('hidden', !doc.is_owner);
    $('editorMoreBtn').disabled = false;
    $('editorActionMenu').querySelector('[data-editor-action="trash"]').classList.toggle('hidden', !doc.is_owner);
    updateBreadcrumb(doc.title); updateWordCount(); setView('editor'); window.scrollTo(0,0);
    $('editorActionMenu').classList.add('hidden');
    if (historyMode !== 'none' && isNewRoute) writeRoute({ view:'editor', docId:id, filter:state.filter }, historyMode);
  } catch (err) { showToast(err.message, true); }
}
async function createDocument(title = 'Untitled document') {
  try {
    await flushPendingSave();
    const doc = await api('/api/documents', { method:'POST', body:JSON.stringify({ title }) });
    state.filter = 'all'; $('searchInput').value = '';
    await loadDocs(); await openDocument(doc.id); $('documentTitle').focus(); $('documentTitle').select();
  } catch (err) { showToast(err.message, true); }
}
function scheduleSave() {
  if (!state.activeDoc || state.activeDoc.access_role === 'viewer') return;
  setSaveStatus('saving', 'Unsaved changes'); clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveDocument, 750);
}
async function saveDocument() {
  if (!state.activeDoc || state.activeDoc.access_role === 'viewer') return;
  if (state.savePromise) { state.saveAgain = true; return state.savePromise; }
  const docId = state.activeDoc.id;
  state.savePromise = (async () => {
    try {
      do {
        state.saveAgain = false; setSaveStatus('saving', 'Saving…');
        const snapshot = { title:$('documentTitle').value.trim() || 'Untitled document', content_html:$('editor').innerHTML };
        const saved = await api(`/api/documents/${encodeURIComponent(docId)}`, { method:'PUT', body:JSON.stringify(snapshot) });
        if (state.activeDoc?.id === docId) {
          state.activeDoc = saved; $('updatedMeta').textContent = 'Saved just now'; updateBreadcrumb(saved.title);
        }
      } while (state.saveAgain && state.activeDoc?.id === docId);
      setSaveStatus('saved', 'All changes saved');
      await loadDocs();
    } catch (err) { setSaveStatus('error', 'Save failed'); showToast(err.message, true); }
    finally { state.savePromise = null; }
  })();
  return state.savePromise;
}
function updateWordCount() {
  const text = $('editor').innerText.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const chars = text.length;
  $('wordCount').textContent = `${words} words · ${chars} characters`;
  $('docWordMeta').textContent = `${words} words`;
}
function runCommand(command, value = null) {
  $('editor').focus(); document.execCommand(command, false, value); updateWordCount(); scheduleSave();
}
function openShareModal() {
  if (!state.activeDoc?.is_owner) return;
  const shared = state.activeDoc.shares || [];
  $('shareEmail').innerHTML = '<option value="">Choose a demo user</option>' + state.users.filter(u => u.email !== state.user).map(u => `<option value="${escapeHTML(u.email)}">${escapeHTML(u.name)} · ${escapeHTML(u.email)}</option>`).join('');
  $('sharePeople').innerHTML = `<div class="share-person"><div class="person-avatar">${escapeHTML(initials(state.activeDoc.owner.name))}</div><div class="person-copy"><strong>${escapeHTML(state.activeDoc.owner.name)} (you)</strong><span>${escapeHTML(state.activeDoc.owner.email)}</span></div><span class="owner-label">Owner</span></div>` + (shared.length ? shared.map(s => `<div class="share-person"><div class="person-avatar">${escapeHTML(initials(s.name))}</div><div class="person-copy"><strong>${escapeHTML(s.name)}</strong><span>${escapeHTML(s.email)}</span></div><select data-share-email="${escapeHTML(s.email)}" aria-label="Permission for ${escapeHTML(s.name)}"><option value="viewer" ${s.role==='viewer'?'selected':''}>Can view</option><option value="editor" ${s.role==='editor'?'selected':''}>Can edit</option></select><button class="remove-share" data-remove-share="${escapeHTML(s.email)}" title="Remove access" aria-label="Remove access">×</button></div>`).join('') : '<div class="no-people">No teammates have access yet.</div>');
  $('shareCount').textContent = shared.length + 1; $('shareModal').classList.remove('hidden');
}
async function refreshActiveDoc() { if (!state.activeDoc) return; state.activeDoc = await api(`/api/documents/${encodeURIComponent(state.activeDoc.id)}`); }
async function importFile(file) {
  if (!file) return;
  const form = new FormData(); form.append('file', file);
  try { await flushPendingSave(); const doc = await api('/api/import', { method:'POST', body:form }); await loadDocs(); await openDocument(doc.id); showToast('File imported as a new document.'); }
  catch (err) { showToast(err.message, true); }
}
async function navigateHome({ historyMode = 'push' } = {}) {
  try { await flushPendingSave(); } catch {}
  state.activeDoc = null; $('editorActionMenu').classList.add('hidden');
  updateBreadcrumb(viewTitle(state.filter)); setView('welcome');
  if (historyMode !== 'none') writeRoute({ view:'home', filter:state.filter }, historyMode);
  await loadDocs();
}
async function applyRoute(route) {
  await flushPendingSave();
  $('shareModal').classList.add('hidden'); $('confirmModal').classList.add('hidden');
  const next = route || { view:'home', filter:'all' };
  state.filter = next.filter || 'all'; $('searchInput').value = '';
  updateBreadcrumb(next.view === 'editor' ? 'Loading document…' : viewTitle(state.filter));
  state.activeDoc = null; setView('welcome');
  await loadDocs();
  if (next.view === 'editor' && next.docId) await openDocument(next.docId, { historyMode:'none' });
}
async function switchUser(email) {
  try {
    await flushPendingSave(); state.user = email; localStorage.setItem('folio-demo-user', email);
    $('userAvatar').textContent = initials(state.users.find(u => u.email === email)?.name);
    state.activeDoc = null; state.filter = 'all'; $('searchInput').value = '';
    writeRoute({ view:'home', filter:'all' }, 'replace'); setView('welcome'); updateBreadcrumb('All documents');
    await loadDocs(); showToast(`Switched to ${state.users.find(u => u.email === email)?.name}`);
  } catch (err) { showToast(err.message, true); }
}
function openConfirm({ title, message, confirmLabel, danger = true, action }) {
  state.pendingConfirm = action;
  $('confirmTitle').textContent = title; $('confirmMessage').textContent = message;
  $('confirmActionBtn').textContent = confirmLabel; $('confirmActionBtn').classList.toggle('danger-button', danger);
  $('confirmModal').classList.remove('hidden');
}
function closeMenus(except = null) {
  document.querySelectorAll('.action-menu').forEach(menu => { if (menu !== except) menu.classList.add('hidden'); });
}
async function trashDocument(id, closeEditor = false) {
  await api(`/api/documents/${encodeURIComponent(id)}`, { method:'DELETE' });
  if (closeEditor) { state.activeDoc = null; setView('welcome'); writeRoute({ view:'home', filter:'all' }, 'replace'); }
  state.filter = state.filter === 'trash' ? 'trash' : 'all';
  if (!closeEditor) writeRoute({ view:'home', filter:state.filter }, 'replace');
  await loadDocs(); showToast('Document moved to Trash.');
}
async function handleCardAction(action, id) {
  const doc = state.docs.find(d => d.id === id) || state.trashDocs.find(d => d.id === id);
  if (!doc) return;
  closeMenus();
  try {
    if (action === 'menu') { const menu = $(`menu-${id}`); if (menu) menu.classList.toggle('hidden'); return; }
    if (action === 'favorite') {
      const result = await api(`/api/documents/${encodeURIComponent(id)}/favorite`, { method:'PUT' });
      await loadDocs(); showToast(result.is_favorite ? 'Added to Starred.' : 'Removed from Starred.'); return;
    }
    if (action === 'rename') {
      const nextTitle = window.prompt('Rename document', doc.title);
      if (nextTitle === null) return;
      const title = nextTitle.trim(); if (!title) return showToast('A document title cannot be empty.', true);
      const full = await api(`/api/documents/${encodeURIComponent(id)}`);
      await api(`/api/documents/${encodeURIComponent(id)}`, { method:'PUT', body:JSON.stringify({ title, content_html:full.content_html }) });
      await loadDocs(); showToast('Document renamed.'); return;
    }
    if (action === 'duplicate') {
      const copy = await api(`/api/documents/${encodeURIComponent(id)}/duplicate`, { method:'POST' });
      await loadDocs(); await openDocument(copy.id); showToast('A copy was created.'); return;
    }
    if (action === 'trash') {
      openConfirm({ title:'Move this document to Trash?', message:`“${doc.title}” will be moved to Trash. You can restore it later.`, confirmLabel:'Move to Trash', action:() => trashDocument(id) }); return;
    }
    if (action === 'restore') {
      await api(`/api/documents/${encodeURIComponent(id)}/restore`, { method:'POST' }); await loadDocs(); showToast('Document restored.'); return;
    }
    if (action === 'permanent') {
      openConfirm({ title:'Delete this document forever?', message:`“${doc.title}” will be permanently deleted. This action cannot be undone.`, confirmLabel:'Delete forever', action:async () => { await api(`/api/documents/${encodeURIComponent(id)}/permanent`, { method:'DELETE' }); await loadDocs(); showToast('Document permanently deleted.'); } });
    }
  } catch (err) { showToast(err.message, true); }
}
function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function documentBaseName() {
  return ($('documentTitle').value.trim() || 'Untitled document').replace(/[\\/:*?"<>|]+/g, '-').slice(0,100);
}
function handleEditorAction(action) {
  closeMenus();
  if (!state.activeDoc) return;
  if (action === 'download') {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(documentBaseName())}</title></head><body>${$('editor').innerHTML}</body></html>`;
    downloadFile(`${documentBaseName()}.html`, html, 'text/html;charset=utf-8');
  } else if (action === 'text') {
    downloadFile(`${documentBaseName()}.txt`, $('editor').innerText, 'text/plain;charset=utf-8');
  } else if (action === 'print') window.print();
  else if (action === 'trash') {
    const id = state.activeDoc.id;
    openConfirm({ title:'Move this document to Trash?', message:'You can restore it later from the Trash view.', confirmLabel:'Move to Trash', action:() => trashDocument(id, true) });
  }
}

// Main navigation and document creation.
$('brandHome').addEventListener('click', () => navigateHome());
$('breadcrumbHome').addEventListener('click', () => navigateHome());
$('newDocBtn').addEventListener('click', () => createDocument());
$('welcomeNewBtn').addEventListener('click', () => createDocument());
$('newFromListBtn').addEventListener('click', () => createDocument());
$('backBtn').addEventListener('click', async () => {
  if (history.state?.folio && history.state.view === 'editor' && history.length > 1) history.back();
  else await navigateHome();
});
window.addEventListener('popstate', (event) => {
  const params = new URLSearchParams(location.search);
  const route = event.state?.folio ? event.state : params.has('doc')
    ? { view:'editor', docId:params.get('doc'), filter:'all' }
    : { view:'home', filter:params.get('view') || 'all' };
  applyRoute(route).catch(err => showToast(err.message, true));
});

// Document list interactions.
$('documentGrid').addEventListener('click', e => {
  const action = e.target.closest('[data-card-action]');
  if (action) { e.stopPropagation(); handleCardAction(action.dataset.cardAction, action.dataset.id); return; }
  const card = e.target.closest('[data-id]'); if (card) openDocument(card.dataset.id);
});
$('documentGrid').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-id]')) { e.preventDefault(); openDocument(e.target.dataset.id); }
});
$('sidebarRecent').addEventListener('click', e => { const item = e.target.closest('[data-id]'); if (item) openDocument(item.dataset.id); });
$('searchInput').addEventListener('input', renderDocs);
$('refreshBtn').addEventListener('click', () => loadDocs().catch(err => showToast(err.message,true)));
document.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', async () => {
  try { await flushPendingSave(); } catch {}
  state.activeDoc = null; state.filter = btn.dataset.filter; $('searchInput').value = '';
  writeRoute({ view:'home', filter:state.filter }); state.activeDoc = null; setView('welcome'); updateBreadcrumb(viewTitle(state.filter));
  try { await loadDocs(); } catch (err) { showToast(err.message, true); }
}));
$('userSelect').addEventListener('change', e => switchUser(e.target.value));

// Editor, formatting, save, and exports.
$('documentTitle').addEventListener('input', () => { updateBreadcrumb($('documentTitle').value || 'Untitled document'); scheduleSave(); });
$('editor').addEventListener('input', () => { updateWordCount(); scheduleSave(); });
$('editor').addEventListener('blur', () => { if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; saveDocument(); } });
$('toolbar').addEventListener('click', e => { const btn = e.target.closest('[data-command]'); if (btn) runCommand(btn.dataset.command, btn.dataset.value || null); });
$('formatSelect').addEventListener('change', e => runCommand('formatBlock', e.target.value));
$('fontSizeSelect').addEventListener('change', e => runCommand('fontSize', e.target.value));
$('clearFormatBtn').addEventListener('click', () => runCommand('removeFormat'));
$('linkBtn').addEventListener('click', () => { const url = window.prompt('Enter a link URL (https://…)'); if (url && /^https?:\/\//i.test(url)) runCommand('createLink', url); else if (url) showToast('Please enter a URL beginning with http:// or https://.', true); });
$('shareBtn').addEventListener('click', openShareModal);
$('editorMoreBtn').addEventListener('click', e => { e.stopPropagation(); const menu = $('editorActionMenu'); closeMenus(menu); menu.classList.toggle('hidden'); });
$('editorActionMenu').addEventListener('click', e => { const item = e.target.closest('[data-editor-action]'); if (item) handleEditorAction(item.dataset.editorAction); });
$('shareModal').addEventListener('click', e => { if (e.target === $('shareModal')) $('shareModal').classList.add('hidden'); });
$('shareModal').querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => $(btn.dataset.close).classList.add('hidden')));
$('grantShareBtn').addEventListener('click', async () => {
  const email = $('shareEmail').value; if (!email) return showToast('Choose a teammate first.', true);
  try { await api(`/api/documents/${encodeURIComponent(state.activeDoc.id)}/shares`, { method:'POST', body:JSON.stringify({ email, role:$('shareRole').value }) }); await refreshActiveDoc(); openShareModal(); await loadDocs(); showToast('Document access updated.'); }
  catch (err) { showToast(err.message, true); }
});
$('sharePeople').addEventListener('change', async e => {
  const select = e.target.closest('[data-share-email]'); if (!select) return;
  try { await api(`/api/documents/${encodeURIComponent(state.activeDoc.id)}/shares/${encodeURIComponent(select.dataset.shareEmail)}`, { method:'PATCH', body:JSON.stringify({ role:select.value }) }); await refreshActiveDoc(); showToast('Permission updated.'); }
  catch (err) { showToast(err.message, true); }
});
$('sharePeople').addEventListener('click', async e => {
  const btn = e.target.closest('[data-remove-share]'); if (!btn) return;
  try { await api(`/api/documents/${encodeURIComponent(state.activeDoc.id)}/shares/${encodeURIComponent(btn.dataset.removeShare)}`, { method:'DELETE' }); await refreshActiveDoc(); openShareModal(); await loadDocs(); showToast('Access removed.'); }
  catch (err) { showToast(err.message, true); }
});
$('welcomeUpload').addEventListener('change', e => { importFile(e.target.files[0]); e.target.value = ''; });

// Confirmation dialog and global shortcuts.
$('cancelConfirmBtn').addEventListener('click', () => { state.pendingConfirm = null; $('confirmModal').classList.add('hidden'); });
$('confirmActionBtn').addEventListener('click', async () => {
  const action = state.pendingConfirm; state.pendingConfirm = null; $('confirmModal').classList.add('hidden');
  if (action) { try { await action(); } catch (err) { showToast(err.message, true); } }
});
document.addEventListener('click', e => { if (!e.target.closest('.menu-anchor')) closeMenus(); });
document.addEventListener('keydown', e => {
  const modifier = e.ctrlKey || e.metaKey;
  if (modifier && e.key.toLowerCase() === 's' && state.activeDoc) { e.preventDefault(); flushPendingSave().then(() => showToast('Document saved.')); }
  else if (modifier && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); createDocument(); }
  else if (modifier && ['b','i','u'].includes(e.key.toLowerCase()) && state.activeDoc) { e.preventDefault(); runCommand({b:'bold',i:'italic',u:'underline'}[e.key.toLowerCase()]); }
  if (e.key === 'Escape') { $('shareModal').classList.add('hidden'); $('confirmModal').classList.add('hidden'); closeMenus(); }
});

(async function boot() {
  try {
    state.users = await api('/api/users');
    $('userSelect').innerHTML = state.users.map(u => `<option value="${escapeHTML(u.email)}">${escapeHTML(u.name)}</option>`).join('');
    const savedUser = localStorage.getItem('folio-demo-user'); state.user = state.users.some(u => u.email === savedUser) ? savedUser : state.users[0].email;
    $('userSelect').value = state.user; $('userAvatar').textContent = initials(state.users.find(u => u.email === state.user)?.name);
    const params = new URLSearchParams(location.search);
    const initialRoute = params.has('doc') ? { folio:true, view:'editor', docId:params.get('doc'), filter:'all' } : { folio:true, view:'home', filter:params.get('view') || 'all' };
    writeRoute(initialRoute, 'replace'); state.filter = initialRoute.filter;
    $('welcomeDate').textContent = new Intl.DateTimeFormat(undefined, { weekday:'long', month:'long', day:'numeric' }).format(new Date()).toUpperCase();
    await loadDocs();
    if (initialRoute.view === 'editor' && initialRoute.docId) await openDocument(initialRoute.docId, { historyMode:'none' });
    state.booted = true;
  } catch (err) { showToast(`Could not start Folio: ${err.message}`, true); }
})();
