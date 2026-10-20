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

test('keeps rendered slots stable between callbacks when native hover re-sorts surviving wrappers', () => {
    const queue = [];
    let children = ['HeroCard15', 'HeroCard52', 'HeroCard6'].map(card);
    const originals = children.slice();
    children.forEach((p, i) => Object.assign(p, { style: {}, actualxoffset: 20 + i * 84,
        actualyoffset: 20, actuallayoutwidth: 80, actuallayoutheight: 120 }));
    const container = { style: {}, actuallayoutwidth: 300, actuallayoutheight: 160,
        actualuiscale_x: 1, actualuiscale_y: 1,
        Children: () => children.slice(), MoveChildBefore: (p, before) => {
            children.splice(children.indexOf(p), 1); children.splice(children.indexOf(before), 0, p);
        } };
    const root = { IsValid: () => true, BHasClass: () => false, FindChildTraverse: () => container };
    sorter.start({ GetContextPanel: () => root, Schedule: (_, fn) => queue.push(fn), Msg: () => {} },
        { 6: 0, 15: 1, 52: 2 });
    queue.shift()();
    // The engine changes sibling order in response to hover, before another JS callback/paint.
    children = originals.slice();
    function renderedOrder() {
        return (container.style.flowChildren === 'none' ? children.slice().sort((a, b) =>
            parseFloat(a.style.position) - parseFloat(b.style.position)) : children).map(p => p.id);
    }
    assert.deepEqual(renderedOrder(), ['HeroCard6', 'HeroCard15', 'HeroCard52'],
        'Native sibling sorting must never expose alphabetical slots between scheduled callbacks');
    assert.equal(container.style.height, '160px');
    assert.ok(children.every(p => p.style.position), 'Pin original wrappers, not cloned hero cards');
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

// Native UpdateHeroGrid reuses anonymous wrappers and assigns hero content by
// sibling INDEX. Geometry is fixed-size, scaled, and does not auto-wrap once
// flowChildren is disabled; the controller must maintain its own safe layout.
function coordinateRoster(names, options = {}) {
    const ranks = { 6: 0, 15: 1, 11: 2, 13: 3, 1: 4, 52: 5, 12: 6, 16: 7 };
    const heroes = { 6: ['Abrams', 'hero_atlas'], 15: ['Bebop', 'hero_bebop'],
        11: ['Dynamo', 'hero_dynamo'], 13: ['Haze', 'hero_haze'],
        1: ['Infernus', 'hero_infernus'], 52: ['Wraith', 'hero_wraith'],
        12: ['Lash', 'hero_lash'], 16: ['Viscous', 'hero_viscous'] };
    const queue = [];
    const messages = [];
    const moves = [];
    const scaleX = options.scaleX || 1;
    const scaleY = options.scaleY || scaleX;
    let width = options.width || 264;
    let ready = options.ready !== false;
    let children;
    const columns = () => Math.max(1, Math.floor((width + 12) / 92));
    function position(panel) {
        if (panel.style.position === undefined) return null;
        const parts = String(panel.style.position).trim().split(/\s+/);
        assert.equal(parts.length, 3, 'Panorama position needs x, y, and z');
        const values = parts.map(part => Number(part.replace(/px$/, '')));
        assert.ok(values.every(Number.isFinite), 'All assigned coordinates must be finite');
        return values;
    }
    function wrapper(name) {
        const label = { text: name };
        const native = { id: '', paneltype: 'CitadelHeroCard',
            FindChildTraverse: id => id === 'HeroName' ? label : null };
        const panel = { id: '', paneltype: 'Panel', style: {},
            Children: () => [native], label, native };
        Object.defineProperties(panel, {
            actuallayoutwidth: { get: () => ready ? 80 * scaleX : 0 },
            actuallayoutheight: { get: () => ready ? 100 * scaleY : 0 },
            actualxoffset: { get: () => {
                const pinned = position(panel);
                return ready ? (20 + (pinned ? pinned[0] : children.indexOf(panel) % columns() * 92)) * scaleX : 0;
            } },
            actualyoffset: { get: () => {
                const pinned = position(panel);
                return ready ? (30 + (pinned ? pinned[1] : Math.floor(children.indexOf(panel) / columns()) * 116)) * scaleY : 0;
            } }
        });
        return panel;
    }
    children = names.map(wrapper);
    const container = { style: {}, actualuiscale_x: scaleX, actualuiscale_y: scaleY,
        Children: () => children.slice(),
        MoveChildBefore: (child, before) => {
            moves.push([child, before]);
            children.splice(children.indexOf(child), 1);
            children.splice(children.indexOf(before), 0, child);
        } };
    Object.defineProperties(container, {
        actuallayoutwidth: { get: () => width * scaleX },
        actuallayoutheight: { get: () => !ready ? 0 : container.style.height === undefined
            ? Math.ceil(children.length / columns()) * 116 * scaleY
            : parseFloat(container.style.height) * scaleY }
    });
    const root = { IsValid: () => true, BHasClass: () => false,
        FindChildTraverse: id => id === 'RosterHeroes' ? container : null };
    const api = { GetContextPanel: () => root, Schedule: (_, fn) => queue.push(fn),
        Msg: message => messages.push(message), Localize: token => token };
    assert.equal(sorter.start(api, ranks, heroes), true);
    return {
        container, moves, messages, position,
        get children() { return children.slice(); },
        get width() { return width; },
        tick() {
            assert.equal(queue.length, 1, 'The live controller must retain exactly one scheduled callback');
            queue.shift()();
        },
        assertRunning() {
            assert.equal(queue.length, 1, 'Filtering or pending layout must not stop the controller: ' + messages.join('\n'));
            assert.ok(messages.every(message => !/Stopped/.test(message)), messages.join('\n'));
            assert.equal(moves.length, 0, 'Styled grids must never move native siblings');
        },
        setReady(value) { ready = value; },
        resize(value) { width = value; },
        replace(nextNames) { children = nextNames.map(wrapper); },
        select(panels) { children = panels.slice(); },
        nativeUpdate(nextNames) {
            assert.equal(nextNames.length, children.length);
            children.forEach((panel, index) => { panel.label.text = nextNames[index]; });
        }
    };
}

function assertCoordinateLayout(roster, expected) {
    roster.assertRunning();
    assert.equal(roster.container.style.flowChildren, 'none', 'Use coordinate layout, not native sibling movement');
    const boxes = roster.children.map(panel => {
        const point = roster.position(panel);
        assert.ok(point, 'Every current wrapper must be pinned, including replacement instances');
        return { panel, x: point[0], y: point[1], width: 80, height: 100 };
    });
    boxes.forEach((box, index) => {
        assert.ok(box.x >= 0 && box.y >= 0, 'Coordinates must stay within the content origin');
        assert.ok(box.x + box.width <= roster.width + 0.01, 'Fixed-size cards must wrap within the current width');
        boxes.slice(index + 1).forEach(other => {
            assert.ok(box.x + box.width <= other.x || other.x + other.width <= box.x ||
                box.y + box.height <= other.y || other.y + other.height <= box.y,
            'Pinned cards must not overlap');
        });
    });
    const rendered = boxes.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    assert.deepEqual(rendered.map(box => box.panel.label.text), expected);
    if (boxes.length) {
        const extent = parseFloat(roster.container.style.height);
        assert.ok(Number.isFinite(extent), 'The scroll content extent must be finite');
        assert.ok(extent >= Math.max(...boxes.map(box => box.y + box.height)),
            'The final row must remain reachable in the scroll content');
    }
    roster.assertRunning();
    return boxes;
}

test('does not rewrite native style objects on every watchdog tick when their getters are opaque', () => {
    const roster = coordinateRoster(coordinateNativeNames);
    let writes = 0;
    roster.children.forEach(panel => {
        panel.style = new Proxy({}, { get: () => undefined,
            set: () => { writes++; return true; } });
    });
    roster.container.style = new Proxy({}, { get: () => undefined,
        set: () => { writes++; return true; } });
    roster.tick();
    const initialWrites = writes;
    assert.ok(initialWrites > 0);
    roster.nativeUpdate(coordinateNativeNames);
    roster.tick();
    roster.tick();
    assert.equal(writes, initialWrites, 'Unchanged visual positions must not keep invalidating native layout');
});

const coordinateNativeNames = ['Bebop', 'Haze', 'Abrams', 'Infernus', 'Wraith', 'Dynamo'];
const coordinateReleaseNames = ['Abrams', 'Bebop', 'Dynamo', 'Haze', 'Infernus', 'Wraith'];

test('coordinate layout preserves native index/content assignments across hover updates without any sibling moves', () => {
    const roster = coordinateRoster(coordinateNativeNames, { scaleX: 1.5, scaleY: 2 });
    const originals = roster.children;
    const nativeCards = originals.map(panel => panel.native);
    roster.tick();
    assertCoordinateLayout(roster, coordinateReleaseNames);
    for (let hover = 0; hover < 3; hover++) {
        // This is the native behavior that moving wrappers previously broke.
        roster.nativeUpdate(coordinateNativeNames);
        assert.deepEqual(roster.children, originals, 'Native wrapper indices must remain unchanged');
        assert.deepEqual(originals.map(panel => panel.Children()[0]), nativeCards);
        assert.deepEqual(originals.map(panel => panel.label.text), coordinateNativeNames);
        assertCoordinateLayout(roster, coordinateReleaseNames); // Before another JS tick/paint.
        roster.tick();
        assertCoordinateLayout(roster, coordinateReleaseNames);
    }
});

test('coordinate layout retries delayed native geometry even when the hero signature is unchanged', () => {
    const roster = coordinateRoster(coordinateNativeNames, { ready: false });
    roster.tick();
    roster.assertRunning();
    roster.children.forEach(panel => {
        if (panel.style.position !== undefined) roster.position(panel);
    });
    roster.setReady(true);
    roster.tick();
    assertCoordinateLayout(roster, coordinateReleaseNames);
});

test('coordinate layout pins new native wrapper instances with the same hero signature', () => {
    const roster = coordinateRoster(coordinateNativeNames);
    roster.tick();
    assertCoordinateLayout(roster, coordinateReleaseNames);
    const originals = roster.children;
    roster.replace(coordinateNativeNames);
    const replacements = roster.children;
    assert.ok(replacements.every(panel => !originals.includes(panel)));
    roster.tick();
    assertCoordinateLayout(roster, coordinateReleaseNames);
    assert.deepEqual(roster.children, replacements, 'Do not reorder replacement wrappers to compensate');
});

test('coordinate layout survives filtered subsets, empty results, and a larger restored roster', () => {
    const roster = coordinateRoster(coordinateNativeNames);
    roster.tick();
    assertCoordinateLayout(roster, coordinateReleaseNames);
    const originals = roster.children;
    roster.select([originals[1], originals[4]]);
    roster.tick();
    assertCoordinateLayout(roster, ['Haze', 'Wraith']);
    roster.select([]);
    roster.tick();
    roster.assertRunning();
    roster.select(originals);
    roster.tick();
    assertCoordinateLayout(roster, coordinateReleaseNames);
    roster.replace([...coordinateNativeNames, 'Lash', 'Viscous']);
    roster.tick();
    assertCoordinateLayout(roster, [...coordinateReleaseNames, 'Lash', 'Viscous']);
});

test('coordinate layout recomputes wraps and scroll extent on narrow and wide resize without a hero change', () => {
    const roster = coordinateRoster(coordinateNativeNames, { scaleX: 1.5, scaleY: 2 });
    roster.tick();
    const before = assertCoordinateLayout(roster, coordinateReleaseNames);
    const initialHeight = parseFloat(roster.container.style.height);
    roster.resize(172);
    roster.tick();
    const narrow = assertCoordinateLayout(roster, coordinateReleaseNames);
    assert.ok(Math.max(...narrow.map(box => box.y)) > Math.max(...before.map(box => box.y)),
        'Narrowing must introduce more rows');
    assert.ok(parseFloat(roster.container.style.height) > initialHeight,
        'Scroll content must grow to include the additional rows');
    roster.resize(540);
    roster.tick();
    const wide = assertCoordinateLayout(roster, coordinateReleaseNames);
    assert.equal(new Set(wide.map(box => box.y)).size, 1, 'All six fixed-size cards fit after widening');
    assert.ok(parseFloat(roster.container.style.height) < initialHeight,
        'Scroll content must shrink again rather than retain stale rows');
});

test('coordinate layout does not learn collapsed geometry from a filtered subset during resize', () => {
    const roster = coordinateRoster(coordinateNativeNames);
    roster.tick();
    assertCoordinateLayout(roster, coordinateReleaseNames);
    const originals = roster.children;
    roster.select([originals[4]]);
    roster.resize(80);
    roster.tick();
    assertCoordinateLayout(roster, ['Wraith']);
    roster.select(originals);
    roster.tick();
    const restored = assertCoordinateLayout(roster, coordinateReleaseNames);
    assert.equal(new Set(restored.map(box => box.y)).size, originals.length,
        'Restored cards need distinct rows at one-card width');
    roster.resize(264);
    roster.tick();
    assertCoordinateLayout(roster, coordinateReleaseNames);
});
