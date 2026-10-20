import { Wheel } from './wheel.js';

const $ = id => document.getElementById(id);
const state = { admin: null, csrf: null, timezone: 'Asia/Kolkata', participants: [], members: [], winners: [],
  counts: {}, ready: false, spinning: false, saving: false, refreshing: false, historyOffset: 0, historyTotal: 0, pendingKey: null };
const wheel = new Wheel($('wheel'));
const modal = new bootstrap.Modal($('member-modal'));
const historyPageSize = 20;
let toastTimer;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
const initials = name => Array.from(name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('')).join('').toUpperCase();
const pendingStorageKey = () => `ld-pending-spin:${state.admin.id}`;

function setPending(key) {
  state.pendingKey = key;
  try {
    if (key) sessionStorage.setItem(pendingStorageKey(), key);
    else sessionStorage.removeItem(pendingStorageKey());
  } catch { /* Recovery still works within this page if browser storage is unavailable. */ }
}

function showLogin() {
  state.ready = false;
  $('dashboard').hidden = true;
  $('login-view').hidden = false;
  modal.hide();
}

async function api(path, { method = 'GET', body, headers = {}, silentAuth = false } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json', ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    const error = new Error('The connection was interrupted. Check your connection and refresh. If a draw was in progress, use Recover draw to check its saved result.');
    error.code = 'NETWORK_ERROR';
    throw error;
  }
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && !silentAuth) showLogin();
    const details = result.error?.details?.map(item => `${item.field}: ${item.message}`).join(' ');
    const error = new Error(details || result.error?.message || 'The request could not be completed.');
    Object.assign(error, { code: result.error?.code, status: response.status });
    throw error;
  }
  return result;
}

function errorBanner(message) { $('global-error').textContent = message || ''; $('global-error').hidden = !message; }
function toast(message) {
  clearTimeout(toastTimer);
  $('toast-message').textContent = message;
  $('toast-message').hidden = false;
  toastTimer = setTimeout(() => { $('toast-message').hidden = true; }, 4000);
}
function date(value, options = {}) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: state.timezone, day: 'numeric', month: 'short', year: 'numeric', ...options }).format(new Date(value));
}
function monthName(month, year, style = 'long') {
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: style, year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 15)));
}
function controls() {
  const busy = state.spinning || state.saving;
  $('spin-button').disabled = !state.ready || busy || state.refreshing || (!state.participants.length && !state.pendingKey);
  $('spin-button').replaceChildren(node('span', '✳'), document.createTextNode(state.spinning ? ' Finding your winner… ' : state.pendingKey ? ' Recover draw ' : ' Spin the wheel '), node('span', '↗'));
  $('add-member').disabled = busy || !state.ready;
  $('refresh-button').disabled = busy || state.refreshing;
  $('logout').disabled = busy;
  $('history-scope').disabled = busy;
  document.querySelectorAll('.row-action').forEach(button => { button.disabled = busy || !state.ready; });
  $('save-member').disabled = state.saving || state.spinning;
  document.querySelectorAll('#member-modal [data-bs-dismiss]').forEach(button => { button.disabled = state.saving; });
  $('history-prev').disabled = state.historyOffset === 0 || busy;
  $('history-next').disabled = state.historyOffset + historyPageSize >= state.historyTotal || busy;
}

function renderStatus(status) {
  Object.assign(state, { period: status.period, timezone: status.period.timezone, counts: status.counts, participants: status.participants, winners: status.winners.items });
  $('period-label').textContent = monthName(status.period.month, status.period.year);
  $('timezone-label').textContent = `Calendar & dates · ${state.timezone}`;
  $('total-count').textContent = status.counts.total;
  $('active-count').textContent = status.counts.active;
  $('remaining-count').textContent = status.counts.remaining;
  $('winner-count').textContent = status.counts.winners;
  $('queue-count').textContent = status.counts.remaining;
  $('eligible-summary').textContent = `View all eligible participants (${status.participants.length})`;
  $('eligible-list').replaceChildren(...status.participants.map(participant => node('li', participant.name)));
  wheel.setParticipants(status.participants);
  const winner = status.winners.items[0];
  $('latest-winner').textContent = winner?.name || 'Your next winner awaits';
  $('latest-winner-date').textContent = winner ? `Celebrated on ${date(winner.won_at, { hour: '2-digit', minute: '2-digit' })}` : "Give the wheel a spin to make someone's day.";
  const queue = $('participant-queue');
  queue.replaceChildren();
  for (const participant of status.participants.slice(0, 4)) {
    const item = node('li');
    const person = node('div', undefined, 'queue-person');
    person.append(node('strong', participant.name), node('span', participant.member_code || 'Ready for a lucky moment'));
    item.append(node('span', initials(participant.name), 'initials'), person, node('span', undefined, 'queue-bullet'));
    queue.append(item);
  }
  if (!status.participants.length) queue.append(node('li', status.counts.active ? "Everyone has had their moment this month. See you next month!" : 'Add or activate a participant to get started.', 'queue-empty'));
  $('queue-more').textContent = status.participants.length > 4 ? `+ ${status.participants.length - 4} more hopeful participants` : '';
  $('wheel-message').textContent = state.pendingKey ? 'A previous draw needs confirmation. Recover its saved result.' : status.participants.length ? `${status.participants.length} ${status.participants.length === 1 ? 'participant is' : 'participants are'} in the running. Who will it be?` : status.counts.active ? 'Everyone has won this month. A fresh draw starts next month.' : 'Add or activate participants to start your first draw.';
}

function personCell(name, email) {
  const cell = node('td');
  const wrap = node('div', undefined, 'person-cell');
  const info = node('div', undefined, 'person-info');
  info.append(node('strong', name));
  if (email) info.append(node('span', email));
  wrap.append(node('span', initials(name), 'initials'), info);
  cell.append(wrap);
  return cell;
}

function emptyRow(body, columns, message) {
  const row = node('tr');
  const cell = node('td', message, 'empty-row');
  cell.colSpan = columns; row.append(cell); body.append(row);
}

function renderMembers() {
  const search = $('member-search').value.trim().toLowerCase();
  const members = state.members.filter(member => [member.name, member.email, member.member_code].some(value => value?.toLowerCase().includes(search)));
  const eligibleIds = new Set(state.participants.map(participant => participant.id));
  const body = $('members-body'); body.replaceChildren();
  $('members-tab-count').textContent = state.members.length;
  for (const member of members) {
    const row = node('tr');
    const status = node('td'); status.append(node('span', member.is_active ? 'Active' : 'Inactive', `status-tag ${member.is_active ? 'tag-active' : 'tag-inactive'}`));
    const eligibility = node('td');
    const eligible = eligibleIds.has(member.id);
    eligibility.append(node('span', !member.is_active ? 'Not in draw' : eligible ? 'In the running' : 'Already celebrated', member.is_active && !eligible ? 'status-tag tag-won' : 'eligibility'));
    const actions = node('td'); const wrap = node('div', undefined, 'row-actions');
    for (const [action, label] of [['edit', 'Edit'], ['toggle', member.is_active ? 'Deactivate' : 'Activate'], ['delete', 'Delete']]) {
      const button = node('button', label, `row-action ${action}`);
      button.dataset.action = action; button.dataset.id = member.id;
      button.setAttribute('aria-label', `${label} ${member.name}`); wrap.append(button);
    }
    actions.append(wrap); row.append(personCell(member.name, member.email), node('td', member.member_code || '—'), status, eligibility, actions); body.append(row);
  }
  if (!members.length) emptyRow(body, 5, search ? 'No participants match your search.' : 'Your circle starts here. Add your first participant.');
  $('member-table-note').textContent = `Showing ${members.length} of ${state.members.length} participants · Names and contact information are visible to administrators only.`;
  controls();
}

function renderHistory(history) {
  state.historyTotal = history.total;
  const body = $('history-body'); body.replaceChildren();
  for (const winner of history.items) {
    const row = node('tr');
    row.append(personCell(winner.name), node('td', date(winner.won_at, { hour: '2-digit', minute: '2-digit' })),
      node('td', new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(winner.draw_year, winner.draw_month - 1, 15)))), node('td', winner.draw_year));
    body.append(row);
  }
  if (!history.items.length) emptyRow(body, 4, 'No lucky moments recorded for this selection yet.');
  $('history-note').textContent = history.total ? `Showing ${history.offset + 1}–${history.offset + history.items.length} of ${history.total} winners · Original draw names are preserved.` : 'Your winner history will appear here.';
  controls();
}

async function loadHistory() {
  const history = await api(`/lucky-draw/winners?scope=${$('history-scope').value}&limit=${historyPageSize}&offset=${state.historyOffset}`);
  renderHistory(history);
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true; controls();
  try {
    const [status, members] = await Promise.all([api('/lucky-draw/status'), api('/members')]);
    renderStatus(status);
    state.members = members.members;
    renderMembers();
    await loadHistory();
    state.ready = true; errorBanner('');
  } catch (error) { state.ready = false; errorBanner(error.message); throw error; }
  finally { state.refreshing = false; controls(); }
}

async function enterDashboard(session) {
  Object.assign(state, { admin: session.admin, csrf: session.csrfToken, timezone: session.timezone });
  try { state.pendingKey = sessionStorage.getItem(pendingStorageKey()); } catch { state.pendingKey = null; }
  $('admin-name').textContent = session.admin.username;
  $('admin-avatar').textContent = initials(session.admin.username);
  $('password').value = '';
  $('login-view').hidden = true; $('dashboard').hidden = false;
  await refresh();
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('login-submit').disabled) return;
  $('login-submit').disabled = true; $('login-error').textContent = '';
  try {
    const session = await api('/auth/login', { method: 'POST', body: { username: $('username').value.trim(), password: $('password').value }, silentAuth: true });
    await enterDashboard(session);
  } catch (error) { $('login-error').textContent = error.message; }
  finally { $('login-submit').disabled = false; }
});

$('logout').addEventListener('click', async () => {
  if (state.spinning || state.saving) return;
  try { await api('/auth/logout', { method: 'POST', body: {} }); state.csrf = null; showLogin(); $('username').focus(); }
  catch (error) { errorBanner(error.message); }
});

$('spin-button').addEventListener('click', async () => {
  if (state.spinning || !state.ready || state.refreshing || (!state.participants.length && !state.pendingKey)) return;
  state.spinning = true; controls(); errorBanner('');
  let confirmed = false;
  let failure;
  try {
    const eligible = await api('/lucky-draw/eligible');
    wheel.setParticipants(eligible.participants);
    if (!state.pendingKey) setPending(crypto.randomUUID());
    $('wheel-message').textContent = 'Recording your lucky moment…';
    const result = await api('/lucky-draw/spin', { method: 'POST', body: {}, headers: { 'Idempotency-Key': state.pendingKey } });
    confirmed = true;
    const selected = result.wheel.participants[result.wheel.winnerIndex];
    if (!selected || selected.id !== result.winner.member_id) throw new Error('The saved draw could not be displayed. Refresh the winner history for the confirmed result.');
    // The server's exact snapshot replaces any stale preflight or another admin's changes.
    wheel.setParticipants(result.wheel.participants);
    $('wheel-message').textContent = 'A lucky moment is on its way…';
    document.body.classList.add('is-spinning');
    await wheel.spin(result.wheel.winnerIndex, result.wheel.participants.length);
    $('wheel-message').textContent = `${result.winner.name} is this month's lucky winner!`;
    const content = node('div');
    content.append(node('div', '✳', 'winner-popup-star'), node('strong', result.winner.name, 'winner-popup-name'),
      node('p', `A lucky moment for ${monthName(result.period.month, result.period.year)}. This win has been recorded.`));
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && typeof confetti === 'function') {
      confetti({ particleCount: 150, spread: 95, origin: { y: 0.58 }, colors: ['#d7f28a', '#1e5145', '#e6bc87', '#b8b0ce'], disableForReducedMotion: true, zIndex: 1090 });
    }
    await Swal.fire({ title: 'A little luck, a big congratulations!', html: content, confirmButtonText: 'Celebrate & continue', allowOutsideClick: false });
    setPending(null);
  } catch (error) {
    // Authentication/rate-limit errors cannot establish whether an earlier request
    // with this key committed. Keep it until the result can be recovered.
    if (!confirmed && ['NO_ELIGIBLE_PARTICIPANTS', 'DRAW_CONFLICT'].includes(error.code)) setPending(null);
    failure = error;
  } finally {
    document.body.classList.remove('is-spinning');
    try { await refresh(); } catch { /* The persistent error banner explains the failure. */ }
    if (failure) errorBanner(`${failure.message}${state.pendingKey ? ' Use Recover draw to confirm the saved result before starting a new draw.' : ''}`);
    state.spinning = false; controls();
  }
});

function openMember(member) {
  if (state.spinning || state.saving) return;
  $('member-form').reset();
  $('member-id').value = member?.id || '';
  $('member-name').value = member?.name || '';
  $('member-code').value = member?.member_code || '';
  $('member-email').value = member?.email || '';
  $('member-active').checked = member?.is_active ?? true;
  $('member-modal-title').textContent = member ? 'Edit participant' : 'Add participant';
  $('member-error').textContent = '';
  modal.show();
}
$('member-modal').addEventListener('shown.bs.modal', () => $('member-name').focus());
$('member-modal').addEventListener('hide.bs.modal', event => { if (state.saving) event.preventDefault(); });
$('add-member').addEventListener('click', () => openMember());
$('member-search').addEventListener('input', renderMembers);
$('members-body').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || state.spinning || state.saving || !state.ready) return;
  const member = state.members.find(item => item.id === button.dataset.id);
  if (!member) return;
  const action = button.dataset.action;
  if (action === 'edit') return openMember(member);
  if (action === 'delete') {
    const answer = await Swal.fire({ title: 'Remove this participant?', text: `${member.name} will leave the draw. Their previous wins will remain in history. Their member code stays reserved.`, icon: 'question', showCancelButton: true, confirmButtonText: 'Remove participant' });
    if (!answer.isConfirmed) return;
  }
  state.saving = true; controls();
  try {
    await api(`/members/${member.id}${action === 'toggle' ? '/status' : ''}`, { method: action === 'toggle' ? 'PATCH' : 'DELETE', body: action === 'toggle' ? { is_active: !member.is_active } : {} });
    await refresh(); toast(action === 'delete' ? 'Participant removed. Winner history preserved.' : 'Participant status updated.');
  } catch (error) { errorBanner(error.message); }
  finally { state.saving = false; controls(); }
});

$('member-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.saving || state.spinning) return;
  state.saving = true; controls(); $('member-error').textContent = '';
  const id = $('member-id').value;
  try {
    await api(`/members${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: {
      name: $('member-name').value.trim(), member_code: $('member-code').value.trim() || null,
      email: $('member-email').value.trim() || null, is_active: $('member-active').checked
    } });
    state.saving = false; modal.hide();
    await refresh(); toast(id ? 'Participant updated.' : 'A new participant joins the circle.');
  } catch (error) { $('member-error').textContent = error.message; errorBanner(error.message); }
  finally { state.saving = false; controls(); }
});

function tab(name, focus = false) {
  for (const value of ['members', 'history']) {
    const selected = name === value;
    $(`tab-${value}`).classList.toggle('active', selected);
    $(`tab-${value}`).setAttribute('aria-selected', String(selected));
    $(`tab-${value}`).tabIndex = selected ? 0 : -1;
    $(`${value}-panel`).hidden = !selected;
  }
  if (focus) $(`tab-${name}`).focus();
}
$('tab-members').addEventListener('click', () => tab('members'));
$('tab-history').addEventListener('click', () => tab('history'));
$('nav-participants').addEventListener('click', () => tab('members'));
$('nav-history').addEventListener('click', () => tab('history'));
document.querySelector('.record-tabs').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); tab(event.key === 'Home' ? 'members' : event.key === 'End' ? 'history' : $('members-panel').hidden ? 'members' : 'history', true); }
});
$('refresh-button').addEventListener('click', () => refresh().catch(() => {}));
$('history-scope').addEventListener('change', () => { state.historyOffset = 0; loadHistory().catch(error => errorBanner(error.message)); });
for (const [id, delta] of [['history-prev', -historyPageSize], ['history-next', historyPageSize]]) {
  $(id).addEventListener('click', async () => {
    state.historyOffset = Math.max(0, state.historyOffset + delta);
    try { await loadHistory(); } catch (error) { errorBanner(error.message); }
  });
}

function backgroundRefresh() {
  if (state.admin && !$('dashboard').hidden && !document.hidden && !state.spinning && !state.saving && !state.refreshing && !$('member-modal').classList.contains('show') && !Swal.isVisible()) refresh().catch(() => {});
}
setInterval(backgroundRefresh, 30000);
document.addEventListener('visibilitychange', backgroundRefresh);
try { await enterDashboard(await api('/auth/session', { silentAuth: true })); }
catch (error) { if (error.status !== 401) $('login-error').textContent = error.message; }
