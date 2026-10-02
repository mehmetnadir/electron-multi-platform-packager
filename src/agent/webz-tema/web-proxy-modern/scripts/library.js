// Flashy Library — set-based (her set tek parça)
window.FlashyLibrary = (() => {
  const KEY = 'flashy_library_sets_v1';

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch { return []; }
  }
  function write(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
    dispatchEvent(new CustomEvent('flashy-library-change', { detail: list }));
  }
  function hasSet(setCode) {
    return read().some(x => x.setCode === setCode);
  }
  /**
   * Set'i kütüphaneye ekle — tek kayıt:
   *   { setCode, publisherName, setTitle, url, books: [...], addedAt }
   */
  function addSet(set) {
    const list = read();
    if (hasSet(set.setCode)) return list;
    list.unshift({ ...set, addedAt: Date.now() });
    write(list);
    return list;
  }
  function removeSet(setCode) {
    const list = read().filter(x => x.setCode !== setCode);
    write(list);
    return list;
  }
  function updateSet(setCode, patch) {
    const list = read().map(x => x.setCode === setCode ? { ...x, ...patch } : x);
    write(list);
    return list;
  }
  function count() { return read().length; }

  return { read, hasSet, addSet, removeSet, updateSet, count };
})();
