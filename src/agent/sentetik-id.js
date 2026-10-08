'use strict';

const SENTETIK_ID_TABAN = 9000000;

/**
 * Verilen id'nin sentetik set kimliği olup olmadığını kontrol eder.
 * Sentetik kimlik: Yalnızca rakamlardan oluşan ve sayısal değeri > 9000000 olan string/sayı.
 * 
 * @param {string|number} id 
 * @returns {boolean}
 */
function sentetikIdMi(id) {
  if (id === null || id === undefined) {
    return false;
  }
  const str = String(id);
  if (!/^\d+$/.test(str)) {
    return false;
  }
  const num = Number(str);
  return num > SENTETIK_ID_TABAN;
}

module.exports = {
  SENTETIK_ID_TABAN,
  sentetikIdMi
};
