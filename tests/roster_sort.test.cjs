'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const sorter = require('../src/panorama/release_order.js');

test('handles same-count native rebuilds, filters, unknown cards, and missing grids', () => {
    const queue = [];
    let children = ['HeroCard15', 'HeroCard6'].map(card);
    let gridPresent = false;
    const container = {
        Children: () => children.slice(),
        MoveChildBefore: (child, before) => {
            children.splice(children.indexOf(child), 1);
            children.splice(children.indexOf(before), 0, child);
        }
    };
    const root = { IsValid: () => true, BHasClass: () => false,
                   FindChildTraverse: () => gridPresent ? container : null };
    const api = { GetContextPanel: () => root, Schedule: (_, callback) => queue.push(callback), Msg: () => {} };
    sorter.start(api, { 6: 0, 15: 1 });
    queue.shift()(); // Grid may not exist at script initialization.
    gridPresent = true;
    queue.shift()();
    assert.deepEqual(children.map(panel => panel.id), ['HeroCard6', 'HeroCard15']);
    const rebuilt = ['HeroCard15', 'HeroCard6'].map(card);
    children = rebuilt.slice(); // New panel instances, same count, native alphabetical order.
    queue.shift()();
    assert.deepEqual(children, [rebuilt[1], rebuilt[0]]);
    children = ['RandomHeroCard', 'HeroCard99', 'HeroCard15', 'Decoration',
                'HeroCard6', 'HeroCard98'].map(card);
    const controls = [children[0], children[3]];
    queue.shift()();
    assert.deepEqual(children.map(panel => panel.id),
                     ['RandomHeroCard', 'HeroCard6', 'HeroCard15', 'Decoration', 'HeroCard99', 'HeroCard98']);
    assert.equal(children[0], controls[0]);
    assert.equal(children[3], controls[1]);
    children = children.filter(panel => panel.id !== 'HeroCard6');
    queue.shift()();
    assert.deepEqual(children.map(panel => panel.id),
                     ['RandomHeroCard', 'HeroCard15', 'Decoration', 'HeroCard99', 'HeroCard98']);
    assert.equal(queue.length, 1);
});

test('stops its controller after a panel API failure without deleting native panels', () => {
    const queue = [];
    const messages = [];
    const children = ['HeroCard15', 'HeroCard6'].map(card);
    const container = { Children: () => children.slice(), MoveChildBefore: () => { throw Error('panel failure'); } };
    const root = { IsValid: () => true, BHasClass: () => false, FindChildTraverse: () => container };
    sorter.start({ GetContextPanel: () => root, Schedule: (_, callback) => queue.push(callback),
                   Msg: message => messages.push(message) }, { 6: 0, 15: 1 });
    assert.doesNotThrow(() => queue.shift()());
    assert.equal(queue.length, 0);
    assert.equal(children.length, 2);
    assert.match(messages[0], /Stopped.*panel failure/);
});

test('does not report success or continue after native panel movement is ignored', () => {
    const queue = [];
    const messages = [];
    const children = ['HeroCard15', 'HeroCard6'].map(card);
    const container = { Children: () => children.slice(), MoveChildBefore: () => {} };
    const root = { IsValid: () => true, BHasClass: () => false, FindChildTraverse: () => container };
    sorter.start({ GetContextPanel: () => root, Schedule: (_, callback) => queue.push(callback),
                   Msg: message => messages.push(message) }, { 6: 0, 15: 1 });
    queue.shift()();
    assert.equal(queue.length, 0, 'Stop rather than endlessly fight unsupported native movement');
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Stopped.*did not take effect/);
    assert.deepEqual(children.map(panel => panel.id), ['HeroCard15', 'HeroCard6']);
});

test('sorts anonymous native wrappers by localized hero labels without reparenting cards', () => {
    const queue = [];
    function wrapper(name) {
        const native = { id: '', paneltype: 'CitadelHeroCard',
                         FindChildTraverse: id => id === 'HeroName' ? { text: name } : null };
        return { id: '', paneltype: 'Panel', Children: () => [native] };
    }
    let children = [wrapper('Bebop traduit'), wrapper('Nouveau héros'), wrapper('Abrams traduit')];
    const original = children.slice();
    const container = {
        Children: () => children.slice(),
        MoveChildBefore: (child, before) => {
            children.splice(children.indexOf(child), 1);
            children.splice(children.indexOf(before), 0, child);
        }
    };
    const root = { IsValid: () => true, BHasClass: () => false, FindChildTraverse: () => container };
    const api = { GetContextPanel: () => root, Schedule: (_, callback) => queue.push(callback), Msg: () => {},
                  Localize: token => ({ '#hero_atlas': 'Abrams traduit', '#hero_bebop': 'Bebop traduit' }[token] || token) };
    sorter.start(api, { 6: 0, 15: 1 }, { 6: ['Abrams', 'hero_atlas'], 15: ['Bebop', 'hero_bebop'] });
    queue.shift()();
    assert.deepEqual(children, [original[2], original[0], original[1]]);
    children = [original[0], original[2], original[1]]; // Same anonymous IDs, changed order.
    queue.shift()();
    assert.deepEqual(children, [original[2], original[0], original[1]]);
    assert.equal(original[2].Children().length, 1);
});

function card(id) { return { id }; }

test('orders native hero cards by the supplied release rank', () => {
    const cards = [card('HeroCard52'), card('HeroCard15'), card('HeroCard6')];
    const ordered = sorter.orderCards(cards, { 6: 0, 15: 1, 52: 2 });
    assert.deepEqual(ordered.map(item => item.id), ['HeroCard6', 'HeroCard15', 'HeroCard52']);
    assert.deepEqual(cards.map(item => item.id), ['HeroCard52', 'HeroCard15', 'HeroCard6']);
});

test('keeps non-hero controls in their slots and unknown heroes in native relative order', () => {
    const cards = ['RandomHeroCard', 'HeroCard99', 'HeroCard15', 'Decoration',
                   'HeroCard6', 'HeroCard98'].map(card);
    assert.deepEqual(sorter.orderCards(cards, { 6: 0, 15: 1 }).map(item => item.id),
                     ['RandomHeroCard', 'HeroCard6', 'HeroCard15', 'Decoration',
                      'HeroCard99', 'HeroCard98']);
});

test('reorders existing native panels in place and does no work when already sorted', () => {
    let children = ['HeroCard52', 'HeroCard15', 'HeroCard6'].map(card);
    const originals = children.slice();
    let moves = 0;
    const container = {
        Children: () => children.slice(),
        MoveChildBefore: (child, before) => {
            moves++;
            children.splice(children.indexOf(child), 1);
            children.splice(children.indexOf(before), 0, child);
        }
    };
    assert.equal(sorter.applyOrder(container, { 6: 0, 15: 1, 52: 2 }), true);
    assert.deepEqual(children, [originals[2], originals[1], originals[0]]);
    const alreadyMoved = moves;
    assert.equal(sorter.applyOrder(container, { 6: 0, 15: 1, 52: 2 }), false);
    assert.equal(moves, alreadyMoved);
});

test('runs one controller, waits while hidden, and stops when the native popup is destroyed', () => {
    const queue = [];
    let hidden = true;
    let valid = true;
    let children = ['HeroCard15', 'HeroCard6'].map(card);
    const container = {
        Children: () => children.slice(),
        MoveChildBefore: (child, before) => {
            children.splice(children.indexOf(child), 1);
            children.splice(children.indexOf(before), 0, child);
        }
    };
    const root = { IsValid: () => valid, BHasClass: () => hidden,
                   FindChildTraverse: id => id === 'RosterHeroes' ? container : null };
    const api = { GetContextPanel: () => root, Schedule: (delay, callback) => queue.push(callback), Msg: () => {} };
    assert.equal(sorter.start(api, { 6: 0, 15: 1 }), true);
    assert.equal(sorter.start(api, { 6: 0, 15: 1 }), false);
    assert.equal(queue.length, 1);
    queue.shift()();
    assert.deepEqual(children.map(item => item.id), ['HeroCard15', 'HeroCard6']);
    assert.equal(queue.length, 1);
    hidden = false;
    queue.shift()();
    assert.deepEqual(children.map(item => item.id), ['HeroCard6', 'HeroCard15']);
    valid = false;
    queue.shift()();
    assert.equal(queue.length, 0);
});
