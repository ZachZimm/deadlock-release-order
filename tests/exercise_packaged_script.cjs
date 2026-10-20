'use strict';
// Execute the actual decompiled packaged script, not the source test exports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(process.argv[2], 'utf8');
const ids = JSON.parse(process.argv[3]).map(String);
const manifest = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const names = Object.fromEntries(manifest.map(hero => [String(hero.hero_id), hero.name]));
assert.equal(ids.length, 43, 'Exercise every known manifest hero');
const queue = [];
const messages = [];
const moves = [];
const columns = 8;
const scaleX = 1.5;
const scaleY = 2;
function wrapper(name) {
    const label = { text: name };
    const card = { id: '', paneltype: 'CitadelHeroCard',
        FindChildTraverse: id => id === 'HeroName' ? label : null };
    return { id: '', paneltype: 'Panel', style: {}, Children: () => [card], label };
}
const children = [{ id: 'RandomHeroCard', style: {} }, wrapper('Unreleased test hero A')]
    .concat(ids.slice().reverse().map(id => wrapper(names[id])), [wrapper('Unreleased test hero B')]);
children.splice(17, 0, { id: 'Decoration', style: {} });
const originals = children.slice();
children.forEach((panel, index) => Object.assign(panel, {
    actualxoffset: (20 + index % columns * 92) * scaleX,
    actualyoffset: (30 + Math.floor(index / columns) * 116) * scaleY,
    actuallayoutwidth: 80 * scaleX,
    actuallayoutheight: 100 * scaleY
}));
const grid = {
    style: {},
    actualuiscale_x: scaleX,
    actualuiscale_y: scaleY,
    actuallayoutwidth: (columns * 92 - 12) * scaleX,
    actuallayoutheight: Math.ceil(children.length / columns) * 116 * scaleY,
    Children: () => children.slice(),
    MoveChildBefore: (child, before) => {
        moves.push([child, before]);
        children.splice(children.indexOf(child), 1);
        children.splice(children.indexOf(before), 0, child);
    }
};
const root = { IsValid: () => true, BHasClass: () => false,
    FindChildTraverse: id => id === 'RosterHeroes' ? grid : null };
const api = { GetContextPanel: () => root, Schedule: (_, callback) => queue.push(callback),
    Msg: message => messages.push(message) };
const nativeAssignments = originals.map(panel => panel.label ? panel.label.text : panel.id);
const nativeCards = originals.map(panel => panel.Children ? panel.Children()[0] : null);
const sortedHeroNames = ids.map(id => names[id]).concat(['Unreleased test hero A', 'Unreleased test hero B']);
let nextHero = 0;
const expected = originals.map(panel => panel.label ? sortedHeroNames[nextHero++] : panel.id);
function assertVisualOrder() {
    assert.equal(moves.length, 0, 'Styled packaged script must never call native MoveChildBefore');
    assert.equal(grid.style.flowChildren, 'none', 'Exercise coordinate pinning, not legacy sibling sorting');
    assert.equal(children.length, originals.length);
    children.forEach((panel, index) => {
        assert.equal(panel, originals[index], 'Preserve the original wrapper at every native child index');
        if (panel.Children) assert.equal(panel.Children()[0], nativeCards[index], 'Do not replace native hero cards');
    });
    const boxes = children.map((panel, index) => {
        assert.ok(panel.style.position, 'Pin every original grid child');
        const parts = String(panel.style.position).trim().split(/\s+/);
        assert.equal(parts.length, 3);
        const position = parts.map(part => Number(part.replace(/px$/, '')));
        assert.ok(position.every(Number.isFinite), 'Pinned coordinates must remain finite');
        const [x, y] = position;
        assert.ok(x >= 0 && y >= 0);
        assert.ok(x + 80 <= grid.actuallayoutwidth / scaleX, 'Cards must remain inside the scroll width');
        if (!panel.label) {
            assert.equal(x, index % columns * 92, 'Non-hero controls keep their native visual slot');
            assert.equal(y, Math.floor(index / columns) * 116, 'Non-hero controls keep their native row');
        }
        return { panel, x, y };
    });
    boxes.forEach((box, index) => boxes.slice(index + 1).forEach(other => {
        assert.ok(box.x + 80 <= other.x || other.x + 80 <= box.x ||
            box.y + 100 <= other.y || other.y + 100 <= box.y, 'Pinned cards must not overlap');
    }));
    const rendered = boxes.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    assert.deepEqual(rendered.map(box => box.panel.label ? box.panel.label.text : box.panel.id), expected);
    const extent = parseFloat(grid.style.height);
    assert.ok(Number.isFinite(extent) && extent >= Math.max(...boxes.map(box => box.y + 100)),
        'The scroll extent must include every card');
    assert.equal(queue.length, 1, 'The packaged controller must continue running');
    assert.ok(messages.every(message => !/Stopped/.test(message)), messages.join('\n'));
}
vm.runInNewContext(script, { $: api }, { timeout: 1000, filename: 'packaged-release-order.js' });
assert.equal(queue.length, 1, 'Actual packaged script must start its controller');
queue.shift()();
assertVisualOrder();
for (let hover = 0; hover < 3; hover++) {
    // Native UpdateHeroGrid writes content BY CHILD INDEX on hover. It does not
    // preserve hero identity on wrappers that a script moved to another index.
    children.forEach((panel, index) => {
        if (panel.label) panel.label.text = nativeAssignments[index];
    });
    assertVisualOrder(); // Verify the frame before the next scheduled callback.
    queue.shift()();
    assertVisualOrder();
}
assert.ok(messages.some(message => message.includes('UI-only roster')));
console.log('Packaged script orders all ' + ids.length +
    ' manifest heroes correctly by visual coordinates, retains unknown heroes, control slots and original wrappers, and makes zero native sibling moves.');
