import { LiveView, element, periodLabel } from './live-view.js';

const $ = id => document.getElementById(id);
const state = { admin: null, csrf: null, members: [], eligible: new Set(), ready: false, busy: false, saving: false, liveBusy: false, connected: false, offset: 0, historyTotal: 0, pending: null, timezone: 'Asia/Kolkata' };
let toastTimeout, refreshing = false;
const pendingKey = () => `draw-pending:${state.admin.id}`;
function pending(value) { state.pending = value; try { if (value) sessionStorage.setItem(pendingKey(), value); else sessionStorage.removeItem(pendingKey()); } catch {} }
function toast(text) { clearTimeout(toastTimeout); $('simple-toast').textContent = text; $('simple-toast').hidden = false; toastTimeout = setTimeout(() => { $('simple-toast').hidden = true; }, 4000); }
function showError(text) { $('admin-error').textContent = text || ''; $('admin-error').hidden = !text; }
function signedOut(message = '') { state.ready = false; $('sign-in').hidden = false; $('admin-content').hidden = true; $('password-dialog').close(); $('login-message').textContent = message; }
async function api(path, { method = 'GET', body, headers = {}, login = false } = {}) {
  let response;
  try { response = await fetch(`/api${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json', ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new Error('Connection interrupted. Try again. Use Recover draw if a spin was being recorded.'); }
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && !login) signedOut('Please sign in again.');
    const error = new Error(result.error?.details?.map(detail => detail.message).join(' ') || result.error?.message || 'Please try again.');
    Object.assign(error, { status: response.status, code: result.error?.code }); throw error;
  }
  return result;
}
function controls() {
  const busy = state.busy || state.saving;
  $('host-spin').disabled = !state.ready || busy || !state.connected || state.liveBusy || (!state.eligible.size && !state.pending);
  $('host-spin').textContent = state.busy ? 'Recording the draw…' : state.liveBusy ? 'The wheel is spinning…' : state.pending ? 'Recover draw ↗' : '✳ Spin the wheel ↗';
  $('save-name').disabled = busy || !state.ready;
  $('account-button').disabled = busy || state.liveBusy;
  $('sign-out').disabled = busy || state.liveBusy;
  $('reload-admin').disabled = busy || refreshing;
  document.querySelectorAll('.name-actions button').forEach(button => { button.disabled = busy || !state.ready; });
  $('history-back').disabled = !state.offset || busy;
  $('history-forward').disabled = state.offset + 20 >= state.historyTotal || busy;
}
const live = new LiveView({
  onState(data) { state.eligible = new Set(data.participants.map(person => person.id)); state.timezone = data.period.timezone; controls(); },
  onConnection(connected) { state.connected = connected; controls(); },
  onBusy(busy) { state.liveBusy = busy; controls(); },
  onWinner(winner) {
    if ($('admin-content').hidden) return;
    if (state.confirmedDrawId === winner.id) pending(null);
    refresh().catch(() => {});
    Swal.fire({ title: `Congratulations, ${winner.name}!`, text: 'This winner is saved in your draw history.', confirmButtonText: 'Lovely! ✳' });
  }
});
function renderNames() {
  const search = $('search-names').value.trim().toLowerCase();
  const names = state.members.filter(person => person.name.toLowerCase().includes(search));
  const list = $('name-list'); list.replaceChildren();
  for (const person of names) {
    const row = element('li');
    const initials = person.name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
    const info = element('div', undefined, 'name-info');
    info.append(element('strong', person.name), element('small', !person.is_active ? 'Inactive' : state.eligible.has(person.id) ? 'In the running' : 'Won this month'));
    const actions = element('div', undefined, 'name-actions');
    for (const [action, label] of [['toggle', person.is_active ? 'Deactivate' : 'Activate'], ['edit', 'Edit'], ['delete', 'Remove']]) {
      const button = element('button', action === 'toggle' ? '' : label, action === 'toggle' ? `switch ${person.is_active ? 'active' : ''}` : '');
      button.dataset.action = action; button.dataset.id = person.id; button.setAttribute('aria-label', `${label} ${person.name}`);
      if (action === 'toggle') { button.setAttribute('role', 'switch'); button.setAttribute('aria-checked', String(person.is_active)); }
      actions.append(button);
    }
    row.append(element('span', initials, 'person-initials'), info, actions); list.append(row);
  }
  if (!names.length) list.append(element('li', search ? 'No names match your search.' : 'Start your circle. Add the first name above.', 'empty-note'));
  controls();
}
async function history() {
  const data = await api(`/lucky-draw/winners?scope=${$('history-filter').value}&limit=20&offset=${state.offset}`);
  if (state.offset && state.offset >= data.total) { state.offset = 0; return history(); }
  state.historyTotal = data.total; $('simple-history').replaceChildren();
  for (const winner of data.items) {
    const row = element('tr');
    row.append(element('td', winner.name), element('td', new Intl.DateTimeFormat('en-IN', { timeZone: state.timezone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(winner.won_at))), element('td', periodLabel({ month: winner.draw_month, year: winner.draw_year })));
    $('simple-history').append(row);
  }
  if (!data.items.length) { const row = element('tr'), cell = element('td', 'Your winners will appear here after the first spin.'); cell.colSpan = 3; row.append(cell); $('simple-history').append(row); }
  $('history-count').textContent = data.total ? `${state.offset + 1}–${state.offset + data.items.length} of ${data.total} winners` : 'No winners yet';
  controls();
}
async function refresh() {
  if (refreshing || !state.admin || $('admin-content').hidden) return;
  refreshing = true; controls();
  try {
    const [status, members] = await Promise.all([api('/lucky-draw/status'), api('/members')]);
    state.members = members.members; state.eligible = new Set(status.participants.map(person => person.id)); state.timezone = status.period.timezone;
    $('stat-total').textContent = status.counts.total; $('stat-remaining').textContent = status.counts.remaining; $('stat-winners').textContent = status.counts.winners;
    $('admin-timezone').textContent = `Monthly calendar and draw dates use ${state.timezone}.`;
    await history(); state.ready = true; renderNames(); showError('');
  } catch (error) { state.ready = false; showError(error.message); throw error; }
  finally { refreshing = false; controls(); }
}
async function enter(session) {
  Object.assign(state, { admin: session.admin, csrf: session.csrfToken, timezone: session.timezone });
  try { state.pending = sessionStorage.getItem(pendingKey()); } catch { state.pending = null; }
  $('login-password').value = ''; $('sign-in').hidden = true; $('admin-content').hidden = false;
  $('share-url').value = `${location.origin}/`;
  if (!state.liveStarted) { state.liveStarted = true; live.start(); }
  await refresh(); await live.refresh();
}
$('sign-in-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('login-button').disabled) return;
  $('login-button').disabled = true; $('login-message').textContent = '';
  try { await enter(await api('/auth/login', { method: 'POST', body: { username: $('login-user').value.trim(), password: $('login-password').value }, login: true })); }
  catch (error) { $('login-message').textContent = error.message; }
  finally { $('login-button').disabled = false; }
});
$('sign-out').addEventListener('click', async () => { try { await api('/auth/logout', { method: 'POST', body: {} }); signedOut(); } catch (error) { showError(error.message); } });
$('copy-link').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('share-url').value); toast('Public draw link copied.'); } catch { $('share-url').focus(); $('share-url').select(); toast('Select and copy this link to share it.'); } });
$('host-spin').addEventListener('click', async () => {
  if ($('host-spin').disabled || state.busy) return;
  state.busy = true; controls(); let failure;
  try {
    if (!state.pending) pending(crypto.randomUUID());
    const result = await api('/lucky-draw/spin', { method: 'POST', body: {}, headers: { 'Idempotency-Key': state.pending } });
    state.confirmedDrawId = result.winner.id;
    await live.refresh();
    if (Date.now() + live.offset > result.live.endsAt) {
      pending(null); toast(`Saved draw recovered: ${result.winner.name}.`); await refresh();
    }
  } catch (error) {
    failure = error;
    if (['NO_ELIGIBLE_PARTICIPANTS', 'DRAW_CONFLICT', 'DRAW_IN_PROGRESS'].includes(error.code)) pending(null);
    try { await refresh(); } catch {}
  } finally {
    state.busy = false; controls();
    if (failure) showError(`${failure.message}${state.pending ? ' Use Recover draw to confirm the saved result.' : ''}`);
  }
});
function resetName() { $('name-form').reset(); $('edit-id').value = ''; $('save-name').textContent = '+ Add name'; $('cancel-edit').hidden = true; $('name-message').textContent = ''; }
$('cancel-edit').addEventListener('click', resetName);
$('name-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.saving || !state.ready) return;
  state.saving = true; controls(); $('name-message').textContent = '';
  const id = $('edit-id').value, existing = state.members.find(person => person.id === id);
  try {
    await api(`/members${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: { name: $('participant-name').value.trim(), member_code: existing?.member_code || null, email: existing?.email || null, is_active: existing?.is_active ?? true } });
    resetName(); await refresh(); await live.refresh(); toast(id ? 'Name updated.' : 'A new name joins the circle.');
  } catch (error) { $('name-message').textContent = error.message; }
  finally { state.saving = false; controls(); }
});
$('search-names').addEventListener('input', renderNames);
$('name-list').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]'); if (!button || state.saving || state.busy) return;
  const person = state.members.find(item => item.id === button.dataset.id); if (!person) return;
  const action = button.dataset.action;
  if (action === 'edit') { $('edit-id').value = person.id; $('participant-name').value = person.name; $('save-name').textContent = 'Save name'; $('cancel-edit').hidden = false; $('participant-name').focus(); return; }
  if (action === 'delete') { const answer = await Swal.fire({ title: 'Remove this name?', text: `${person.name} will leave the wheel. Past wins stay in history.`, showCancelButton: true, confirmButtonText: 'Remove name' }); if (!answer.isConfirmed) return; }
  state.saving = true; controls();
  try { await api(`/members/${person.id}${action === 'toggle' ? '/status' : ''}`, { method: action === 'toggle' ? 'PATCH' : 'DELETE', body: action === 'toggle' ? { is_active: !person.is_active } : {} }); await refresh(); await live.refresh(); }
  catch (error) { showError(error.message); }
  finally { state.saving = false; controls(); }
});
$('account-button').addEventListener('click', () => { $('password-form').reset(); $('password-message').textContent = ''; $('password-dialog').showModal(); $('old-password').focus(); });
$('close-password').addEventListener('click', () => $('password-dialog').close());
$('password-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('password-save').disabled) return;
  $('password-save').disabled = true; $('close-password').disabled = true; $('password-message').textContent = '';
  try {
    const result = await api('/auth/password', { method: 'POST', body: { current_password: $('old-password').value, new_password: $('new-password').value, confirm_password: $('confirm-password').value } });
    signedOut(result.message); $('password-form').reset(); $('login-password').focus();
  } catch (error) { $('password-message').textContent = error.message; }
  finally { $('password-save').disabled = false; $('close-password').disabled = false; }
});
$('reload-admin').addEventListener('click', () => { refresh().catch(() => {}); live.refresh(); });
$('history-filter').addEventListener('change', () => { state.offset = 0; history().catch(error => showError(error.message)); });
for (const [id, change] of [['history-back', -20], ['history-forward', 20]]) $(id).addEventListener('click', () => { state.offset = Math.max(0, state.offset + change); history().catch(error => showError(error.message)); });
setInterval(() => { if (!document.hidden && !state.busy && !state.saving && !$('password-dialog').open) refresh().catch(() => {}); }, 15000);
try { await enter(await api('/auth/session', { login: true })); } catch (error) { if (error.status !== 401) $('login-message').textContent = error.message; }
