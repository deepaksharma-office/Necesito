const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_FIRST_DATE_PATTERN = /^(\d{2})-(\d{2})-(\d{4})$/;

class LocalEventsCalendar extends HTMLElement {
  connectedCallback() {
    if (this.controller) this.controller.abort();
    this.controller = new AbortController();
    this.today = new Date();
    this.today = new Date(this.today.getFullYear(), this.today.getMonth(), this.today.getDate());
    this.startMonth = new Date(this.today.getFullYear(), this.today.getMonth(), 1);
    this.currentMonth = new Date(this.startMonth);
    this.endMonth = new Date(this.startMonth.getFullYear(), this.startMonth.getMonth() + 11, 1);
    this.grid = this.querySelector('[data-calendar-grid]');
    this.heading = this.querySelector('[data-month-heading]');
    this.dialog = this.querySelector('[data-dialog]');
    this.dialogTitle = this.querySelector('[data-dialog-title]');
    this.dialogContent = this.querySelector('[data-dialog-content]');
    this.entries = this.readEntries();
    this.entriesByDate = new Map();
    for (const entry of this.entries) {
      const normalizedDate = this.normalizeDate(entry.date);
      if (!normalizedDate) continue;
      entry.date = normalizedDate;
      const values = this.entriesByDate.get(normalizedDate) || [];
      values.push(entry);
      this.entriesByDate.set(normalizedDate, values);
    }
    this.querySelector('[data-empty-state]').hidden = this.entriesByDate.size > 0;
    this.addEventListener('click', this.handleClick, { signal: this.controller.signal });
    this.dialog.addEventListener('click', this.handleDialogClick, { signal: this.controller.signal });
    this.dialog.addEventListener('close', () => document.documentElement.removeAttribute('scroll-lock'), { signal: this.controller.signal });
    this.render();
  }

  disconnectedCallback() { this.controller?.abort(); }

  readEntries() {
    try { return JSON.parse(this.querySelector('[data-calendar-data]').textContent); }
    catch (error) { console.error('Local events calendar data could not be read.', error); return []; }
  }

  normalizeDate(value) {
    if (typeof value !== 'string') return null;
    const dateValue = value.trim();
    const isoMatch = dateValue.match(ISO_DATE_PATTERN);
    const dayFirstMatch = dateValue.match(DAY_FIRST_DATE_PATTERN);
    const parts = isoMatch
      ? { year: Number(isoMatch[1]), month: Number(isoMatch[2]), day: Number(isoMatch[3]) }
      : dayFirstMatch
        ? { year: Number(dayFirstMatch[3]), month: Number(dayFirstMatch[2]), day: Number(dayFirstMatch[1]) }
        : null;
    if (!parts) return null;
    const date = new Date(parts.year, parts.month - 1, parts.day);
    if (date.getFullYear() !== parts.year || date.getMonth() !== parts.month - 1 || date.getDate() !== parts.day) return null;
    return this.toKey(date);
  }

  handleClick = (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'previous') this.move(-1);
    if (action === 'next') this.move(1);
    if (action === 'today') { this.currentMonth = new Date(this.startMonth); this.render(); }
    const day = event.target.closest('[data-date]');
    if (day) this.openDate(day.dataset.date);
  };

  handleDialogClick = (event) => {
    if (event.target === this.dialog || event.target.closest('[data-dialog-close]')) this.dialog.close();
  };

  move(offset) {
    const next = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() + offset, 1);
    if (next < this.startMonth || next > this.endMonth) return;
    this.currentMonth = next;
    this.render();
  }

  render() {
    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    this.heading.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(this.currentMonth);
    this.querySelector('[data-action="previous"]').disabled = this.currentMonth.getTime() === this.startMonth.getTime();
    this.querySelector('[data-action="next"]').disabled = this.currentMonth.getTime() === this.endMonth.getTime();
    this.grid.replaceChildren();
    const first = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - first.getDay());
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      this.grid.append(this.createDay(date, month));
    }
  }

  createDay(date, visibleMonth) {
    const key = this.toKey(date);
    const entries = this.entriesByDate.get(key) || [];
    const cell = document.createElement(entries.length ? 'button' : 'div');
    cell.className = 'local-events-calendar__day';
    cell.setAttribute('role', 'gridcell');
    if (date.getMonth() !== visibleMonth) cell.classList.add('is-outside');
    if (date.getTime() === this.today.getTime()) cell.classList.add('is-today');
    const number = document.createElement('span');
    number.className = 'local-events-calendar__number';
    number.textContent = date.getDate();
    cell.append(number);
    if (entries.length) {
      cell.type = 'button';
      cell.dataset.date = key;
      cell.classList.add('has-events');
      for (const type of new Set(entries.map((entry) => entry.type))) cell.classList.add(`has-${type}`);
      cell.setAttribute('aria-label', `${new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date)}: ${entries.length} calendar ${entries.length === 1 ? 'entry' : 'entries'}`);
      const markers = document.createElement('span');
      markers.className = 'local-events-calendar__markers';
      const types = [...new Set(entries.map((entry) => entry.type))];
      for (const type of types) {
        const marker = document.createElement('i');
        marker.className = `local-events-calendar__marker is-${type}`;
        marker.setAttribute('aria-hidden', 'true');
        markers.append(marker);
      }
      if (entries.length > 1) { const count = document.createElement('span'); count.className = 'local-events-calendar__count'; count.textContent = `+${entries.length}`; markers.append(count); }
      cell.append(markers);
    }
    return cell;
  }

  openDate(key) {
    const entries = this.entriesByDate.get(key);
    if (!entries?.length) return;
    const date = new Date(`${key}T12:00:00`);
    this.dialogTitle.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
    this.dialogContent.replaceChildren(...entries.map((entry) => this.createEntry(entry, date)));
    document.documentElement.setAttribute('scroll-lock', '');
    this.dialog.showModal();
  }

  createEntry(entry, date) {
    const article = document.createElement('article');
    article.className = 'local-events-calendar__entry';
    if (entry.image) { const image = document.createElement('img'); image.src = entry.image; image.alt = ''; image.loading = 'lazy'; article.append(image); }
    const badge = document.createElement('span');
    badge.className = `local-events-calendar__entry-badge${entry.type === 'closure' ? ' is-closure' : ''}`;
    badge.textContent = entry.type === 'closure' ? 'Scheduled closure' : (entry.category || 'Event');
    article.append(badge);
    const title = document.createElement('h3'); title.textContent = entry.title || (entry.type === 'closure' ? 'Scheduled closure' : 'Community event'); article.append(title);
    const metaParts = [new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(date)];
    if (entry.startTime) metaParts.push(entry.endTime ? `${entry.startTime}–${entry.endTime}` : entry.startTime);
    if (entry.location) metaParts.push(entry.location);
    const meta = document.createElement('p'); meta.className = 'local-events-calendar__entry-meta'; meta.textContent = metaParts.join(' · '); article.append(meta);
    if (entry.description) { const description = document.createElement('p'); description.textContent = entry.description; article.append(description); }
    if (entry.reopening) { const reopening = document.createElement('p'); reopening.textContent = entry.reopening; article.append(reopening); }
    if (entry.url) { const link = document.createElement('a'); link.className = 'local-events-calendar__entry-link'; link.href = entry.url; link.textContent = 'Event information ↗'; article.append(link); }
    return article;
  }

  toKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

if (!customElements.get('local-events-calendar')) customElements.define('local-events-calendar', LocalEventsCalendar);
