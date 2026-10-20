(function () {
    'use strict';
    var RELEASE_RANKS = /*__RELEASE_RANKS__*/{};
    var RELEASE_HEROES = /*__RELEASE_HEROES__*/{};

    function normalized(text) {
        return String(text || '').trim().toLowerCase();
    }

    function nameAliases(api, heroes) {
        var aliases = Object.create(null);
        function add(name, id) {
            var key = normalized(name);
            if (!key || key.charAt(0) === '#') { return; }
            aliases[key] = Object.prototype.hasOwnProperty.call(aliases, key) && aliases[key] !== id ? null : id;
        }
        Object.keys(heroes || {}).forEach(function (id) {
            add(heroes[id][0], id);
            if (typeof api.Localize === 'function') {
                ['#' + heroes[id][1], '#' + heroes[id][1] + ':n'].forEach(function (token) {
                    try { add(api.Localize(token), id); } catch (_) { /* English fallback remains. */ }
                });
            }
        });
        return aliases;
    }

    function heroId(panel, aliases, depth) {
        var match = /^HeroCard(\d+)$/.exec(panel.id || '');
        if (match) { return match[1]; }
        if (panel.paneltype === 'CitadelHeroCard' && typeof panel.FindChildTraverse === 'function') {
            var label = panel.FindChildTraverse('HeroName');
            var name = normalized(label && label.text);
            if (!name) { return null; }
            return aliases && Object.prototype.hasOwnProperty.call(aliases, name) && aliases[name] !== null
                ? aliases[name] : 'unknown:' + name;
        }
        // Current native grid entries are anonymous wrappers around anonymous hero cards.
        // Identify the card inside, but move only the original direct grid child.
        depth = depth === undefined ? 4 : depth;
        if (depth > 0 && typeof panel.Children === 'function') {
            var ids = panel.Children().map(function (child) { return heroId(child, aliases, depth - 1); })
                .filter(function (id) { return id !== null; });
            if (ids.length === 1) { return ids[0]; }
        }
        return null;
    }

    function signature(cards, aliases) {
        return cards.map(function (panel) { return heroId(panel, aliases) || panel.id || ''; }).join('|');
    }

    function orderCards(cards, ranks, aliases) {
        var heroes = cards.map(function (panel, index) {
            return { panel: panel, id: heroId(panel, aliases), index: index };
        }).filter(function (item) { return item.id !== null; });
        heroes.sort(function (left, right) {
            var leftRank = Object.prototype.hasOwnProperty.call(ranks, left.id) ? ranks[left.id] : Infinity;
            var rightRank = Object.prototype.hasOwnProperty.call(ranks, right.id) ? ranks[right.id] : Infinity;
            return (leftRank - rightRank) || (left.index - right.index);
        });
        var next = 0;
        return cards.map(function (panel) {
            return heroId(panel, aliases) === null ? panel : heroes[next++].panel;
        });
    }

    function applyOrder(container, ranks, aliases) {
        var wanted = orderCards(container.Children(), ranks, aliases);
        var changed = false;
        for (var i = 0; i < wanted.length; i++) {
            var current = container.Children();
            if (current[i] !== wanted[i]) {
                container.MoveChildBefore(wanted[i], current[i]);
                changed = true;
            }
        }
        var actual = container.Children();
        if (actual.length !== wanted.length || actual.some(function (panel, index) {
            return panel !== wanted[index];
        })) {
            throw new Error('Native panel movement did not take effect');
        }
        return changed;
    }

    // Native UpdateHeroGrid rebinds heroes by sibling index. Never move those
    // wrappers: keep their native indices and change only their visual positions.
    function pinOrder(container, ranks, aliases, state) {
        var cards = container.Children();
        var scaleX = container.actualuiscale_x || 1;
        var scaleY = container.actualuiscale_y || scaleX;
        if (!container.style) { return applyOrder(container, ranks, aliases); }
        if (!cards.length) { return false; }
        if (!state.geometry) {
            if (!(container.actuallayoutheight > 0) || !(container.actuallayoutwidth > 0)
                    || cards.some(function (p) { return !p.style || !(p.actuallayoutwidth > 0)
                        || !(p.actuallayoutheight > 0); })) {
                return false; // Native layout is not ready; retry without caching failure.
            }
            var xs = cards.map(function (p) { return p.actualxoffset / scaleX; }).sort(function (a, b) { return a - b; });
            var ys = cards.map(function (p) { return p.actualyoffset / scaleY; }).sort(function (a, b) { return a - b; });
            function pitch(values, fallback) {
                var step = Infinity;
                for (var i = 1; i < values.length; i++) {
                    if (values[i] - values[i - 1] > 0.5) { step = Math.min(step, values[i] - values[i - 1]); }
                }
                return isFinite(step) ? step : fallback;
            }
            var width = Math.max.apply(null, cards.map(function (p) { return p.actuallayoutwidth / scaleX; }));
            var height = Math.max.apply(null, cards.map(function (p) { return p.actuallayoutheight / scaleY; }));
            state.geometry = {
                x: Math.max(width, pitch(xs, width)), y: Math.max(height, pitch(ys, height)),
                width: width, height: height,
                padX: Math.max(0, Math.min(2 * xs[0], container.actuallayoutwidth / scaleX - (xs[xs.length - 1] - xs[0] + width))),
                padY: Math.max(0, container.actuallayoutheight / scaleY - (ys[ys.length - 1] - ys[0] + height))
            };
        }
        var g = state.geometry;
        var columns = Math.max(1, Math.floor((container.actuallayoutwidth / scaleX - g.padX + g.x - g.width + 0.5) / g.x));
        var wanted = orderCards(cards, ranks, aliases);
        var changed = !state.pinned;
        wanted.forEach(function (panel, index) {
            var value = (index % columns * g.x) + 'px ' + (Math.floor(index / columns) * g.y) + 'px 0px';
            if (panel.__releaseOrderPosition !== value) {
                panel.style.position = value;
                panel.__releaseOrderPosition = value;
                changed = true;
            }
        });
        var extent = (Math.ceil(cards.length / columns) - 1) * g.y + g.height + g.padY;
        var heightValue = extent + 'px';
        if (state.height !== heightValue) { container.style.height = heightValue; state.height = heightValue; }
        if (!state.pinned) { container.style.flowChildren = 'none'; state.pinned = true; }
        return changed;
    }

    function start(api, ranks, heroes) {
        var root = api.GetContextPanel();
        if (!root || typeof root.IsValid !== 'function' || typeof root.FindChildTraverse !== 'function'
                || root.__releaseOrderState) {
            return false;
        }
        var state = { signature: null, reported: false };
        root.__releaseOrderState = state;
        var aliases = nameAliases(api, heroes);
        function tick() {
            if (!root.IsValid()) { return; }
            try {
                if (root.BHasClass('Hidden')) {
                    api.Schedule(0.75, tick);
                    return;
                }
                var container = root.FindChildTraverse('RosterHeroes');
                if (container && typeof container.Children === 'function'
                        && typeof container.MoveChildBefore === 'function') {
                    var cards = container.Children();
                    var currentSignature = signature(cards, aliases);
                    if (currentSignature !== state.signature || container.style) {
                        var changed = pinOrder(container, ranks, aliases, state);
                        state.signature = signature(container.Children(), aliases);
                        if ((changed || !state.reported) && cards.some(function (panel) { return heroId(panel, aliases) !== null; })) {
                            api.Msg('[release-order] UI-only roster: ' + signature(orderCards(cards, ranks, aliases), aliases));
                            state.reported = true;
                        }
                    }
                }
                api.Schedule(0.25, tick);
            } catch (error) {
                api.Msg('[release-order] Stopped; leaving native UI available: ' + String(error));
            }
        }
        api.Schedule(0.1, tick);
        return true;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { orderCards: orderCards, applyOrder: applyOrder, start: start };
    }
    if (typeof $ !== 'undefined' && typeof $.GetContextPanel === 'function') {
        start($, RELEASE_RANKS, RELEASE_HEROES);
    }
}());
