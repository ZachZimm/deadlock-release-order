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
                    if (currentSignature !== state.signature) {
                        var changed = applyOrder(container, ranks, aliases);
                        state.signature = signature(container.Children(), aliases);
                        if ((changed || !state.reported) && cards.some(function (panel) { return heroId(panel, aliases) !== null; })) {
                            api.Msg('[release-order] UI-only roster: ' + state.signature);
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
