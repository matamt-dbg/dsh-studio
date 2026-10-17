// @ts-nocheck -- ported verbatim from @local/dsh-session-cycle 0.1.0 order.js (DSH 0.2.0-rc.2 sidebar order).
/** Sidebar session order, reconstructed from the workspace browser's saved view `dsh.workspace.view.v5`.
 * This reads a private DSH UI store (user-approved, #28 D1); unknown shapes throw so callers block instead of guessing.
 * Node-testable: no DOM or runtime imports.
 */
// Compatibility adapter for @deepseek-ai/dsh-client-ui-workspace 0.2.0-rc.2.
// Source: lib/client.js:259-383, 420-438, 616-637, 658-667,
// 2340-2345, 2424-2436, 2540-2544, 2827-2868. No DOM or runtime imports.
const VIEW_KEY = "dsh.workspace.view.v5";
const FLAT_KEY = "__flat_session_order__";
const record = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message) => {
    throw new TypeError(`Session cycle: ${message}`);
};
const id = (value) => typeof value === "string" && value.length > 0;
function ids(value, label, unique = true) {
    if (
        !Array.isArray(value) ||
        !value.every(id) ||
        (unique && new Set(value).size !== value.length)
    )
        fail(`invalid ${label}`);
}
function validateView(value) {
    if (!record(value)) fail("invalid workspace view");
    if (!["workspace", "workspace-tree", "flat"].includes(value.groupBy))
        fail("invalid groupBy");
    if (!["updated", "manual"].includes(value.orderBy)) fail("invalid orderBy");
    if (
        !record(value.groupExpansion) ||
        !Object.values(value.groupExpansion).every(
            (v) => typeof v === "boolean",
        )
    )
        fail("invalid groupExpansion");
    if (!record(value.sessionOrderByAccount))
        fail("invalid sessionOrderByAccount");
    for (const order of Object.values(value.sessionOrderByAccount))
        ids(order, "manual order", false);
    const archivedFilter =
        value.archivedFilter === undefined ? "default" : value.archivedFilter;
    if (!["default", "show", "only"].includes(archivedFilter))
        fail("invalid archivedFilter");
    return { ...value, archivedFilter };
}

/** Missing storage value uses shipped defaults; unreadable/malformed state blocks cycling. */
export function readView(storage) {
    if (!storage || typeof storage.getItem !== "function")
        fail("storage is unavailable");
    const raw = storage.getItem(VIEW_KEY);
    if (raw === null)
        return {
            groupBy: "workspace",
            orderBy: "updated",
            groupExpansion: {},
            sessionOrderByAccount: {},
            archivedFilter: "default",
        };
    if (typeof raw !== "string") fail("invalid stored workspace view");
    let value;
    try {
        value = JSON.parse(raw);
    } catch {
        fail("malformed workspace view JSON");
    }
    return validateView(value);
}

function validateSessions(sessions) {
    if (!record(sessions) || !record(sessions.byId))
        fail("invalid sessions snapshot");
    ids(sessions.ids, "session IDs");
    for (const [key, session] of Object.entries(sessions.byId)) {
        if (
            !record(session) ||
            !id(key) ||
            session.id !== key ||
            !Number.isFinite(session.updatedAt) ||
            typeof session.blank !== "boolean" ||
            !record(session.retainedBy) ||
            (session.retainedBy.mainView !== undefined &&
                (!Number.isFinite(session.retainedBy.mainView) ||
                    session.retainedBy.mainView < 0)) ||
            (session.parentId !== undefined && !id(session.parentId)) ||
            (session.origin !== undefined && typeof session.origin !== "string")
        )
            fail(`invalid session summary: ${key}`);
    }
}

/** Main selection is retention, not ids[0], running status, or workspace active ID. */
export function currentSessionId(sessions) {
    validateSessions(sessions);
    return Object.values(sessions.byId).find(
        (session) => (session.retainedBy.mainView ?? 0) > 0,
    )?.id;
}

function validateWorkspaces(workspaces) {
    if (!record(workspaces) || !Array.isArray(workspaces.items))
        fail("invalid workspaces snapshot");
    ids(workspaces.pinnedSessionIds, "pinned IDs");
    ids(workspaces.archivedSessionIds, "archived IDs");
    const keys = new Set();
    const members = new Set();
    for (const workspace of workspaces.items) {
        if (
            !record(workspace) ||
            !id(workspace.workspaceId) ||
            workspace.workspaceId === FLAT_KEY ||
            typeof workspace.path !== "string" ||
            keys.has(workspace.workspaceId)
        )
            fail("invalid workspace");
        keys.add(workspace.workspaceId);
        ids(workspace.sessionIds, "workspace session IDs");
        for (const member of workspace.sessionIds) {
            if (members.has(member))
                fail("session belongs to multiple workspaces");
            members.add(member);
        }
    }
}

function recent(memberIds, summaries) {
    return memberIds
        .filter((key) => summaries[key] !== undefined)
        .sort((a, b) => {
            const left = summaries[a].updatedAt,
                right = summaries[b].updatedAt;
            return left !== right ? right - left : a < b ? -1 : 1;
        });
}

// Reconciliation deliberately retains archive/hidden slots until AFTER fork insertion.
function manual(memberIds, saved, summaries, rowState) {
    const members = new Set(memberIds),
        included = new Set(),
        ordered = [];
    for (const key of saved ?? []) {
        if (!members.has(key) || included.has(key)) continue;
        ordered.push(key);
        included.add(key);
    }
    const archived = new Set(rowState.archivedSessionIds),
        pins = [];
    for (const key of rowState.pinnedSessionIds) {
        if (
            !members.has(key) ||
            included.has(key) ||
            archived.has(key) ||
            summaries[key] === undefined
        )
            continue;
        pins.push(key);
        included.add(key);
    }
    const ordinary = [],
        archives = [];
    for (const key of recent(
        [...members].filter((key) => !included.has(key)),
        summaries,
    )) {
        (archived.has(key) ? archives : ordinary).push(key);
    }
    const result = [...pins, ...ordered, ...ordinary, ...archives];
    const pending = new Set(ordinary);
    const placeFork = (key) => {
        if (!pending.delete(key)) return;
        const parent = summaries[key]?.parentId;
        if (parent === undefined || parent === key || !result.includes(parent))
            return;
        placeFork(parent);
        result.splice(result.indexOf(key), 1);
        result.splice(result.indexOf(parent), 0, key);
    };
    for (const key of [...ordinary].reverse()) placeFork(key);
    return result;
}

function folderPath(path) {
    return (
        /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("\\\\")
            ? path.replaceAll("\\", "/")
            : path
    ).replace(/\/+$/, "");
}

/**
 * Reconstruct all navigable sidebar rows, ignoring collapse and show-more limits.
 * Archive-only yields []: archived rows are displayed but guardedOpen forbids them.
 * Search is transient component state, not part of the persisted view contract.
 */
export function orderedSessionIds(sessions, workspaces, view) {
    validateSessions(sessions);
    validateWorkspaces(workspaces);
    view = validateView(view);
    const current = currentSessionId(sessions);
    const summaries = sessions.byId;
    const archived = new Set(workspaces.archivedSessionIds);
    const pinned = new Set(workspaces.pinnedSessionIds);
    const visible = (key) => {
        const session = summaries[key];
        return (
            session !== undefined &&
            session.origin !== "subagent" &&
            (!session.blank || key === current)
        );
    };
    if (view.archivedFilter === "only") return [];
    const order = (members, account) =>
        view.orderBy === "updated"
            ? recent(members, summaries)
            : manual(
                  members,
                  view.sessionOrderByAccount[account],
                  summaries,
                  workspaces,
              );
    const section = (members, account) => {
        const placeholders = [],
            pins = [],
            rest = [];
        for (const key of order(members, account)) {
            if (!visible(key) || archived.has(key)) continue;
            (summaries[key].blank
                ? placeholders
                : pinned.has(key)
                  ? pins
                  : rest
            ).push(key);
        }
        return [...placeholders, ...pins, ...rest];
    };
    if (view.groupBy === "flat")
        return section(sessions.ids.filter(visible), FLAT_KEY);
    const accounted = new Set(
        workspaces.items.flatMap((workspace) => workspace.sessionIds),
    );
    const stray = sessions.ids.filter(
        (key) => summaries[key] !== undefined && !accounted.has(key),
    );
    const groups = workspaces.items.map((workspace) => ({
        key: workspace.workspaceId,
        path: workspace.path,
        rows: section(workspace.sessionIds, workspace.workspaceId),
    }));
    if (view.groupBy === "workspace")
        return [
            ...groups.flatMap((group) => group.rows),
            ...section(stray, ""),
        ];
    // Source renders nested child groups before a parent's own session rows.
    const keysByPath = new Map(groups.map((group) => [group.path, group.key]));
    const children = new Map();
    for (const group of groups) {
        const child = folderPath(group.path);
        let owner,
            length = -1;
        for (const [path, key] of keysByPath) {
            const root = folderPath(path);
            if (
                root.length > length &&
                child !== root &&
                child.startsWith(`${root}/`)
            ) {
                owner = key;
                length = root.length;
            }
        }
        if (!children.has(owner)) children.set(owner, []);
        children.get(owner).push(group);
    }
    const flatten = (owner) =>
        (children.get(owner) ?? []).flatMap((group) => [
            ...flatten(group.key),
            ...group.rows,
        ]);
    return [...flatten(undefined), ...section(stray, "")];
}

/** Wrap only from a known current row; empty/singleton/absent current are no-ops. */
export function adjacentSession(sessionIds, current, direction) {
    ids(sessionIds, "navigation IDs");
    if (current !== undefined && current !== null && !id(current))
        fail("invalid current session ID");
    const delta =
        direction === "next" || direction === 1
            ? 1
            : direction === "previous" || direction === -1
              ? -1
              : fail("invalid navigation direction");
    if (sessionIds.length < 2) return null;
    const index = sessionIds.indexOf(current);
    if (index < 0) return null;
    return sessionIds[(index + delta + sessionIds.length) % sessionIds.length];
}
