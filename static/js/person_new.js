const form = document.getElementById('new-person-form');
const alertBox = document.getElementById('alert-box');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const data = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith('address_')) continue;
    data[key] = value || null;
  }
  data.address = {
    classification: fd.get('address_classification') || null,
    zip: fd.get('address_zip') || null,
    prefecture: fd.get('address_prefecture') || null,
    city: fd.get('address_city') || null,
    block: fd.get('address_block') || null,
    building: fd.get('address_building') || null,
    nearest_station: fd.get('address_nearest_station') || null,
  };

  try {
    const result = await apiPostJson('/api/people', data);
    window.location.href = `/people/${result.id}`;
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
});

bindZipAutofill({
  zip: form.elements['address_zip'],
  prefecture: form.elements['address_prefecture'],
  city: form.elements['address_city'],
  block: form.elements['address_block'],
  button: document.getElementById('address-zip-lookup'),
});
