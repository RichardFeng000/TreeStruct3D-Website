/** Reject incomplete native response fields before any model geometry changes. */
export function validateNativeResponse(response, floats) {
  const fail = (reason) => { throw new Error(`Invalid native edit data: ${reason}.`); };
  if (Object.prototype.toString.call(floats) !== '[object Float32Array]') fail('expected a Float32 geometry buffer');
  if (!response || !Array.isArray(response.parts) || !response.parts.length
    || !Array.isArray(response.controls) || !response.controls.length) fail('missing parts or controls');
  if (response.version !== 1 || response.coordinate_system !== 'blender_z_up') fail('unsupported response version or coordinates');
  if (response.compression !== undefined && response.compression !== 'gzip') fail('unsupported native buffer compression');
  for (let i = 0; i < floats.length; i += 1) if (!Number.isFinite(floats[i])) fail(`nonfinite geometry value at ${i}`);
  const descriptor = (value, label, count = null) => {
    if (!value || !Number.isSafeInteger(value.offset) || !Number.isSafeInteger(value.count)
      || value.offset < 0 || value.count < 0 || value.offset + value.count > floats.length) fail(`${label} exceeds the geometry buffer`);
    if (count !== null && value.count !== count) fail(`${label} has the wrong length`);
  };
  const unique = (items, key, label) => {
    const values = items.map((item) => item?.[key]);
    if (values.some((value) => typeof value !== 'string' || !value) || new Set(values).size !== values.length) fail(`duplicate or missing ${label}`);
    return new Set(values);
  };
  const partIds = unique(response.parts, 'id', 'part IDs');
  const controlIds = unique(response.controls, 'id', 'control IDs');
  const optionalList = (owner, key) => {
    if (owner[key] === undefined) return [];
    if (!Array.isArray(owner[key])) fail(`${key} is not a list`);
    return owner[key];
  };
  const point = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  const controlReference = (id, label) => { if (!controlIds.has(id)) fail(`${label} references an unknown control`); };
  const parts = new Map(response.parts.map((part) => [part.id, part]));
  for (const part of response.parts) {
    descriptor(part.positions, `${part.id} positions`);
    if (!part.positions.count || part.positions.count % 3) fail(`${part.id} positions are not complete XYZ vertices`);
  }
  const anchors = optionalList(response, 'anchors');
  for (const anchor of anchors) {
    if (!partIds.has(anchor.parent) || !partIds.has(anchor.child)) fail('anchor references an unknown part');
    for (const key of ['parent_world', 'child_world']) {
      if (!point(anchor[key])) fail('anchor has an invalid coordinate');
    }
  }
  const sampleFields = (sample, label) => {
    if (!sample || !Array.isArray(sample.parts)) fail(`${label} has no part response list`);
    const seen = new Set();
    for (const part of sample.parts) {
      if (!parts.has(part.id) || seen.has(part.id)) fail(`${label} references an unknown or duplicate part`);
      seen.add(part.id);
      descriptor(part.delta, `${label}/${part.id} delta`, parts.get(part.id).positions.count);
    }
    if (sample.anchors) descriptor(sample.anchors, `${label} anchors`, anchors.length * 6);
  };
  const scalesValid = (values, label) => {
    if (!Array.isArray(values) || values.length < 3 || values.some((scale) => !Number.isFinite(scale) || scale < 0.4 || scale > 1.6)
      || new Set(values).size !== values.length || !values.includes(1) || !values.includes(0.4) || !values.includes(1.6)) fail(`${label} does not cover the supported scales`);
  };
  for (const control of response.controls) {
    if (!Array.isArray(control.samples)) fail(`${control.id} has no samples`);
    scalesValid(control.samples.map((sample) => sample?.scale), control.id);
    for (const sample of control.samples) sampleFields(sample, `${control.id}@${sample.scale}`);
  }
  for (const interaction of optionalList(response, 'interactions')) {
    if (!interaction) fail('mixed response is missing');
    if (!Array.isArray(interaction.ids) || interaction.ids.length < 2 || new Set(interaction.ids).size !== interaction.ids.length
      || interaction.ids.some((id) => !controlIds.has(id))) fail('mixed response references invalid controls');
    if (!Array.isArray(interaction.knots) || interaction.knots.length !== interaction.ids.length) fail('mixed response has invalid knots');
    interaction.knots.forEach((knots, index) => scalesValid(knots, `mixed ${interaction.ids[index]}`));
    if (!Array.isArray(interaction.samples)) fail('mixed response has no samples');
    const seen = new Set();
    for (const sample of interaction.samples) {
      if (!Array.isArray(sample.scales) || sample.scales.length !== interaction.ids.length
        || sample.scales.some((value, index) => !interaction.knots[index].includes(value))) fail('mixed sample is outside its knots');
      const key = JSON.stringify(sample.scales);
      if (seen.has(key)) fail('duplicate mixed sample');
      seen.add(key);
      sampleFields(sample, `mixed ${key}`);
    }
    const combinations = interaction.knots.reduce((count, knots) => count * knots.length, 1);
    if (seen.size !== combinations) fail('mixed response is missing a knot combination');
  }
  const ratios = new Set();
  for (const interaction of optionalList(response, 'ratio_interactions')) {
    if (!interaction) fail('ratio response is missing');
    const numerator = interaction.numerator_control, denominator = interaction.denominator_control;
    controlReference(numerator, 'ratio numerator'); controlReference(denominator, 'ratio denominator');
    const key = JSON.stringify([numerator, denominator]);
    if (numerator === denominator || ratios.has(key)) fail('duplicate or self-referencing ratio response');
    ratios.add(key);
    if (!Array.isArray(interaction.samples)) fail('ratio response has no samples');
    const values = interaction.samples.map((sample) => sample?.ratio);
    if (values.length < 3 || values.some((value) => !Number.isFinite(value) || value <= 0)
      || new Set(values).size !== values.length || !values.includes(1)
      || Math.min(...values) > 0.25 || Math.max(...values) < 4) fail('ratio response does not cover the supported parameter range');
    for (const sample of interaction.samples) sampleFields(sample, `ratio ${key}@${sample.ratio}`);
  }
  const procedural = optionalList(response, 'procedural');
  const proceduralIds = unique(procedural, 'id', 'procedural part IDs');
  for (const item of procedural) {
    if (item.type !== 'chameleon_limb') fail('unsupported procedural geometry type');
    if (!partIds.has(item.id)) fail('procedural geometry references an unknown part');
    controlReference(item.torso_control, 'procedural torso'); controlReference(item.limb_control, 'procedural limb');
    if (item.torso_control === item.limb_control) fail('procedural torso and limb controls must differ');
    if (!['left', 'right'].includes(item.side) || typeof item.is_hind !== 'boolean') fail('invalid Chameleon limb identity');
    if (item.coarse_count !== 84 || !Number.isSafeInteger(item.vertex_count) || item.vertex_count <= 0
      || item.vertex_count * 3 !== parts.get(item.id).positions.count) fail('invalid Chameleon vertex dimensions');
    descriptor(item.weights, `${item.id} subdivision weights`, item.vertex_count * item.coarse_count);
    const grid = item.snap_scales;
    if (!grid || grid.min !== 0.4 || grid.step !== 0.01 || grid.count !== 121) fail('unsupported Chameleon snap scale grid');
    descriptor(item.snap_indices, `${item.id} snap choices`, grid.count * grid.count);
    for (let i = item.snap_indices.offset; i < item.snap_indices.offset + item.snap_indices.count; i += 1) {
      if (!Number.isInteger(floats[i]) || floats[i] < 0 || floats[i] >= item.coarse_count) fail('Chameleon snap choice is not a coarse vertex');
    }
    for (let row = 0; row < item.vertex_count; row += 1) {
      let sum = 0;
      for (let col = 0; col < item.coarse_count; col += 1) {
        const weight = floats[item.weights.offset + row * item.coarse_count + col];
        if (weight < -1e-6 || weight > 1 + 1e-6) fail('invalid Chameleon subdivision weight');
        sum += weight;
      }
      if (Math.abs(sum - 1) > 1e-4) fail('Chameleon subdivision row does not preserve position');
    }
  }
  const replacements = optionalList(response, 'replacements');
  unique(replacements, 'id', 'replacement part IDs');
  for (const item of replacements) {
    if (!partIds.has(item.id) || proceduralIds.has(item.id)) fail('replacement references an unknown or already procedural part');
    controlReference(item.control, 'replacement');
    const names = item.material_names;
    if (!Array.isArray(names) || !names.length || names.some((name) => typeof name !== 'string' || !name)
      || new Set(names).size !== names.length) fail('replacement has invalid material names');
    if (!Array.isArray(item.samples) || item.samples.length !== 121) fail('replacement must include every supported hundredth scale');
    const scaleKeys = new Set();
    for (const sample of item.samples) {
      const key = Math.round(sample?.scale * 100);
      if (!Number.isFinite(sample?.scale) || Math.abs(sample.scale * 100 - key) > 1e-7 || key < 40 || key > 160 || scaleKeys.has(key)) fail('replacement has an invalid or duplicate scale');
      scaleKeys.add(key);
      descriptor(sample.positions, `${item.id} replacement positions`);
      if (!sample.positions.count || sample.positions.count % 3) fail('replacement positions are not complete XYZ vertices');
      descriptor(sample.normals, `${item.id} replacement normals`, sample.positions.count);
      descriptor(sample.triangles, `${item.id} replacement triangles`);
      if (!sample.triangles.count || sample.triangles.count % 3) fail('replacement triangles are incomplete');
      descriptor(sample.materials, `${item.id} replacement materials`, sample.triangles.count / 3);
      for (let i = sample.triangles.offset; i < sample.triangles.offset + sample.triangles.count; i += 1) {
        if (!Number.isInteger(floats[i]) || floats[i] < 0 || floats[i] >= sample.positions.count / 3) fail('replacement triangle references an invalid vertex');
      }
      for (let i = sample.materials.offset; i < sample.materials.offset + sample.materials.count; i += 1) {
        if (!Number.isInteger(floats[i]) || floats[i] < 0 || floats[i] >= names.length) fail('replacement triangle references an invalid material');
      }
    }
    const translations = optionalList(item, 'translation_controls');
    unique(translations, 'id', 'replacement translation controls');
    for (const translation of translations) {
      controlReference(translation.id, 'replacement translation');
      if (translation.id === item.control || !Array.isArray(translation.samples)) fail('invalid replacement translation control');
      scalesValid(translation.samples.map((sample) => sample?.scale), 'replacement translation');
      if (translation.samples.some((sample) => !point(sample.delta))) fail('replacement translation is not a finite XYZ vector');
    }
  }
  // Extensions may add procedural/replacement arrays. Check every float-buffer
  // descriptor even before its renderer is supported, without rejecting fields
  // that do not describe a buffer (e.g. snap_scales has a count but no offset).
  const walk = (value, path) => {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'offset')) descriptor(value, path);
    for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') walk(child, `${path}.${key}`);
  };
  walk(response, 'response');
  return response;
}
