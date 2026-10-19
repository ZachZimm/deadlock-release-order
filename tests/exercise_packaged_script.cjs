'use strict';
// Execute the actual decompiled packaged script, not the source test exports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(process.argv[2], 'utf8');
const ids = JSON.parse(process.argv[3]).map(String);
const manifest = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const names = Object.fromEntries(manifest.map(hero => [String(hero.hero_id), hero.name]));
const queue = [];
const messages = [];
function wrapper(name) {
    const card = { id: '', paneltype: 'CitadelHeroCard',
                   FindChildTraverse: id => id === 'HeroName' ? { text: name } : null };
    return { id: '', paneltype: 'Panel', Children: () => [card], testName: name };
}
const children = [{ id: 'RandomHeroCard' }, wrapper('Unreleased test hero A')]
    .concat(ids.slice().reverse().map(id => wrapper(names[id])), [wrapper('Unreleased test hero B')]);
const originals = children.slice();
const grid = {
    Children: () => children.slice(),
    MoveChildBefore: (child, before) => {
        children.splice(children.indexOf(child), 1);
        children.splice(children.indexOf(before), 0, child);
    }
};
const root = { IsValid: () => true, BHasClass: () => false,
               FindChildTraverse: id => id === 'RosterHeroes' ? grid : null };
const api = { GetContextPanel: () => root, Schedule: (_, callback) => queue.push(callback),
              Msg: message => messages.push(message) };
vm.runInNewContext(script, { $: api }, { timeout: 1000, filename: 'packaged-release-order.js' });
assert.equal(queue.length, 1, 'Actual packaged script must start its controller');
queue.shift()();
assert.deepEqual(children.map(panel => panel.testName || panel.id), ['RandomHeroCard']
    .concat(ids.map(id => names[id]), ['Unreleased test hero A', 'Unreleased test hero B']));
assert.equal(new Set(children).size, originals.length);
assert.ok(originals.every(panel => children.includes(panel)), 'Keep original native instances');
assert.ok(messages.some(message => message.includes('UI-only roster')));
console.log('Packaged script orders all ' + ids.length + ' manifest heroes correctly and retains unknown cards.');
