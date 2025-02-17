import {
  Properties,
  ChildProperties,
  Aliases,
  getPropAlias,
  SVGNamespace,
  DelegatedEvents
} from "./constants";
import {
  root,
  effect,
  memo,
  getOwner,
  createComponent,
  sharedConfig,
  untrack,
  mergeProps,
  flatten
} from "rxcore";
import reconcileArrays from "./reconcile";
export {
  Properties,
  ChildProperties,
  getPropAlias,
  Aliases,
  DOMElements,
  SVGElements,
  SVGNamespace,
  DelegatedEvents
} from "./constants";

const $$EVENTS = "_$DX_DELEGATE";

export {
  effect,
  memo,
  untrack,
  getOwner,
  createComponent,
  mergeProps,
  voidFn as useAssets,
  voidFn as getAssets,
  voidFn as Assets,
  voidFn as generateHydrationScript,
  voidFn as HydrationScript,
  voidFn as getRequestEvent
};

export function render(code, element, init, options = {}) {
  if ("_DX_DEV_" && !element) {
    throw new Error(
      "The `element` passed to `render(..., element)` doesn't exist. Make sure `element` exists in the document."
    );
  }
  let disposer;
  root(dispose => {
    disposer = dispose;
    element === document
      ? code()
      : insert(element, code(), element.firstChild ? null : undefined, init);
  }, options.owner);
  return () => {
    disposer();
    element.textContent = "";
  };
}

export function template(html, isImportNode, isSVG) {
  let node;
  const create = () => {
    if ("_DX_DEV_" && isHydrating())
      throw new Error(
        "Failed attempt to create new DOM elements during hydration. Check that the libraries you are using support hydration."
      );
    const t = document.createElement("template");
    t.innerHTML = html;
    return isSVG ? t.content.firstChild.firstChild : t.content.firstChild;
  };
  return isImportNode
    ? () => untrack(() => document.importNode(node || (node = create()), true))
    : () => (node || (node = create())).cloneNode(true);
}

export function delegateEvents(eventNames, document = window.document) {
  const e = document[$$EVENTS] || (document[$$EVENTS] = new Set());
  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];
    if (!e.has(name)) {
      e.add(name);
      document.addEventListener(name, eventHandler);
    }
  }
}

export function clearDelegatedEvents(document = window.document) {
  if (document[$$EVENTS]) {
    for (let name of document[$$EVENTS].keys()) document.removeEventListener(name, eventHandler);
    delete document[$$EVENTS];
  }
}

export function setProperty(node, name, value) {
  node[name] = value;
}

export function setAttribute(node, name, value) {
  if (value == null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}

export function setAttributeNS(node, namespace, name, value) {
  if (value == null) node.removeAttributeNS(namespace, name);
  else node.setAttributeNS(namespace, name, value);
}

export function setBoolAttribute(node, name, value) {
  if (isHydrating(node)) return;
  value ? node.setAttribute(name, "") : node.removeAttribute(name);
}

export function className(node, value) {
  if (value == null) node.removeAttribute("class");
  else node.className = value;
}

export function addEventListener(node, name, handler, delegate) {
  if (delegate) {
    if (Array.isArray(handler)) {
      node[`$$${name}`] = handler[0];
      node[`$$${name}Data`] = handler[1];
    } else node[`$$${name}`] = handler;
  } else if (Array.isArray(handler)) {
    const handlerFn = handler[0];
    node.addEventListener(name, (handler[0] = e => handlerFn.call(node, handler[1], e)));
  } else node.addEventListener(name, handler, typeof handler !== "function" && handler);
}

export function classListToObject(classList) {
  if (Array.isArray(classList)) {
    const result = {};

    for (let i = 0, len = classList.length; i < len; i++) {
      const key = classList[i];
      if (typeof key === "object" && key !== null) Object.assign(result, key);
      else if (key || key === 0) result[key] = true;
    }

    return result;
  }

  return classList;
}

export function classList(node, value, prev = {}) {
  prev = classListToObject(prev);
  value = classListToObject(value);

  const classKeys = Object.keys(value || {});
  const prevKeys = Object.keys(prev);

  let i, len;
  for (i = 0, len = prevKeys.length; i < len; i++) {
    const key = prevKeys[i];
    if (!key || key === "undefined" || value[key]) continue;
    toggleClassKey(node, key, false);
    delete prev[key];
  }

  for (i = 0, len = classKeys.length; i < len; i++) {
    const key = classKeys[i],
      classValue = !!value[key];
    if (!key || key === "undefined" || prev[key] === classValue || !classValue) continue;
    toggleClassKey(node, key, true);
    prev[key] = classValue;
  }

  return prev;
}

export function style(node, value, prev) {
  if (!value) return prev ? setAttribute(node, "style") : value;
  const nodeStyle = node.style;
  if (typeof value === "string") return (nodeStyle.cssText = value);
  typeof prev === "string" && (nodeStyle.cssText = prev = undefined);
  prev || (prev = {});
  value || (value = {});
  let v, s;
  for (s in prev) {
    value[s] == null && nodeStyle.removeProperty(s);
    delete prev[s];
  }
  for (s in value) {
    v = value[s];
    if (v !== prev[s]) {
      nodeStyle.setProperty(s, v);
      prev[s] = v;
    }
  }
  return prev;
}

// TODO: make this better
export function spread(node, props = {}, isSVG, skipChildren) {
  const prevProps = {};
  if (!skipChildren) {
    effect(
      () => normalize(props.children, prevProps.children),
      value => {
        insertExpression(node, value, prevProps.children);
        prevProps.children = value;
      }
    );
  }
  effect(
    () => typeof props.ref === "function" && use(props.ref, node),
    () => {}
  );
  effect(
    () => {
      const newProps = {};
      for (const prop in props) {
        if (prop === "children" || prop === "ref") continue;
        newProps[prop] = props[prop];
      }
      return newProps;
    },
    props => assign(node, props, isSVG, true, prevProps, true)
  );
  return prevProps;
}

export function dynamicProperty(props, key) {
  const src = props[key];
  Object.defineProperty(props, key, {
    get() {
      return src();
    },
    enumerable: true
  });
  return props;
}

export function use(fn, element, arg) {
  untrack(() => fn(element, arg));
}

export function insert(parent, accessor, marker, initial) {
  const multi = marker !== undefined;
  if (multi && !initial) initial = [];
  if (typeof accessor !== "function") {
    accessor = normalize(accessor, initial, multi, true);
    if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
  }
  effect(
    prev => normalize(accessor, prev, multi),
    (value, current) => insertExpression(parent, value, current, marker),
    initial
  );
}

export function assign(node, props, isSVG, skipChildren, prevProps = {}, skipRef = false) {
  props || (props = {});
  for (const prop in prevProps) {
    if (!(prop in props)) {
      if (prop === "children") continue;
      prevProps[prop] = assignProp(node, prop, null, prevProps[prop], isSVG, skipRef);
    }
  }
  for (const prop in props) {
    if (prop === "children") {
      if (!skipChildren) insertExpression(node, props.children);
      continue;
    }
    const value = props[prop];
    prevProps[prop] = assignProp(node, prop, value, prevProps[prop], isSVG, skipRef);
  }
}

// Hydrate
export function hydrate(code, element, options = {}) {
  if (globalThis._$HY.done) return render(code, element, [...element.childNodes], options);
  sharedConfig.completed = globalThis._$HY.completed;
  sharedConfig.events = globalThis._$HY.events;
  sharedConfig.load = id => globalThis._$HY.r[id];
  sharedConfig.has = id => id in globalThis._$HY.r;
  sharedConfig.gather = root => gatherHydratable(element, root);
  sharedConfig.registry = new Map();
  sharedConfig.context = {
    id: options.renderId || "",
    count: 0
  };
  try {
    gatherHydratable(element, options.renderId);
    return render(code, element, [...element.childNodes], options);
  } finally {
    sharedConfig.context = null;
  }
}

export function getNextElement(template) {
  let node,
    key,
    hydrating = isHydrating();
  if (!hydrating || !(node = sharedConfig.registry.get((key = getHydrationKey())))) {
    if ("_DX_DEV_" && hydrating) {
      sharedConfig.done = true;
      throw new Error(
        `Hydration Mismatch. Unable to find DOM nodes for hydration key: ${key}\n${
          template ? template().outerHTML : ""
        }`
      );
    }
    return template();
  }
  if (sharedConfig.completed) sharedConfig.completed.add(node);
  sharedConfig.registry.delete(key);
  return node;
}

export function getNextMatch(el, nodeName) {
  while (el && el.localName !== nodeName) el = el.nextSibling;
  return el;
}

export function getNextMarker(start) {
  let end = start,
    count = 0,
    current = [];
  if (isHydrating(start)) {
    while (end) {
      if (end.nodeType === 8) {
        const v = end.nodeValue;
        if (v === "$") count++;
        else if (v === "/") {
          if (count === 0) return [end, current];
          count--;
        }
      }
      current.push(end);
      end = end.nextSibling;
    }
  }
  return [end, current];
}

export function runHydrationEvents() {
  if (sharedConfig.events && !sharedConfig.events.queued) {
    queueMicrotask(() => {
      const { completed, events } = sharedConfig;
      if (!events) return;
      events.queued = false;
      while (events.length) {
        const [el, e] = events[0];
        if (!completed.has(el)) return;
        events.shift();
        eventHandler(e);
      }
      if (sharedConfig.done) {
        sharedConfig.events = _$HY.events = null;
        sharedConfig.completed = _$HY.completed = null;
      }
    });
    sharedConfig.events.queued = true;
  }
}

// Internal Functions
function isHydrating(node) {
  return !!sharedConfig.context && !sharedConfig.done && (!node || node.isConnected);
}

function toggleClassKey(node, key, value) {
  const classNames = key.trim().split(/\s+/);
  for (let i = 0, nameLen = classNames.length; i < nameLen; i++)
    node.classList.toggle(classNames[i], value);
}

function assignProp(node, prop, value, prev, isSVG, skipRef) {
  let propAlias, forceProp;
  if (prop === "style") return style(node, value, prev);
  if (prop === "classList") return classList(node, value, prev);
  if (value === prev) return prev;
  if (prop === "ref") {
    if (!skipRef) value(node);
  } else if (prop.slice(0, 3) === "on:") {
    const e = prop.slice(3);
    prev && node.removeEventListener(e, prev, typeof prev !== "function" && prev);
    value && node.addEventListener(e, value, typeof value !== "function" && value);
  } else if (prop.slice(0, 2) === "on") {
    const name = prop.slice(2).toLowerCase();
    const delegate = DelegatedEvents.has(name);
    if (!delegate && prev) {
      const h = Array.isArray(prev) ? prev[0] : prev;
      node.removeEventListener(name, h);
    }
    if (delegate || value) {
      addEventListener(node, name, value, delegate);
      delegate && delegateEvents([name]);
    }
  } else if (prop.slice(0, 5) === "attr:") {
    setAttribute(node, prop.slice(5), value);
  } else if (prop.slice(0, 5) === "bool:") {
    setBoolAttribute(node, prop.slice(5), value);
  } else if (
    (forceProp = prop.slice(0, 5) === "prop:") ||
    ChildProperties.has(prop) ||
    (!isSVG && (propAlias = getPropAlias(prop, node.tagName))) ||
    Properties.has(prop)
  ) {
    if (forceProp) prop = prop.slice(5);
    if (prop === "class" || prop === "className") className(node, value);
    else node[propAlias || prop] = value;
  } else {
    const ns = isSVG && prop.indexOf(":") > -1 && SVGNamespace[prop.split(":")[0]];
    if (ns) setAttributeNS(node, ns, prop, value);
    else setAttribute(node, Aliases[prop] || prop, value);
  }
  return value;
}

function eventHandler(e) {
  if (sharedConfig.registry && sharedConfig.events) {
    if (sharedConfig.events.find(([el, ev]) => ev === e)) return;
  }

  let node = e.target;
  const key = `$$${e.type}`;
  const oriTarget = e.target;
  const oriCurrentTarget = e.currentTarget;
  const retarget = value =>
    Object.defineProperty(e, "target", {
      configurable: true,
      value
    });
  const handleNode = () => {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== undefined ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble) return;
    }
    node.host &&
      typeof node.host !== "string" &&
      !node.host._$host &&
      node.contains(e.target) &&
      retarget(node.host);
    return true;
  };
  const walkUpTree = () => {
    while (handleNode() && (node = node._$host || node.parentNode || node.host));
  };

  // simulate currentTarget
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || document;
    }
  });
  // cancel hydration
  if (sharedConfig.registry && !sharedConfig.done) sharedConfig.done = _$HY.done = true;

  if (e.composedPath) {
    const path = e.composedPath();
    retarget(path[0]);
    for (let i = 0; i < path.length - 2; i++) {
      node = path[i];
      if (!handleNode()) break;
      if (node._$host) {
        node = node._$host;
        // bubble up from portal mount instead of composedPath
        walkUpTree();
        break;
      }
      if (node.parentNode === oriCurrentTarget) {
        break; // don't bubble above root of event delegation
      }
    }
  }
  // fallback for browsers that don't support composedPath
  else walkUpTree();
  // Mixing portals and shadow dom can lead to a nonstandard target, so reset here.
  retarget(oriTarget);
}

function insertExpression(parent, value, current, marker) {
  if (value === current) return;
  const t = typeof value,
    multi = marker !== undefined;
  // is this necessary anymore?
  // parent = (multi && current[0] && current[0].parentNode) || parent;

  if (t === "string" || t === "number") {
    const tc = typeof current;
    if (tc === "string" || tc === "number") {
      parent.firstChild.data = value;
    } else parent.textContent = value;
  } else if (value === undefined) {
    cleanChildren(parent, current, marker);
  } else if (value.nodeType) {
    if (Array.isArray(current)) {
      cleanChildren(parent, current, multi ? marker : null, value);
    } else if (current === undefined || !parent.firstChild) {
      parent.appendChild(value);
    } else parent.replaceChild(value, parent.firstChild);
  } else if (Array.isArray(value)) {
    const currentArray = current && Array.isArray(current);
    if (value.length === 0) {
      cleanChildren(parent, current, marker);
    } else if (currentArray) {
      if (current.length === 0) {
        appendNodes(parent, value, marker);
      } else reconcileArrays(parent, current, value);
    } else {
      current && cleanChildren(parent);
      appendNodes(parent, value);
    }
  } else if ("_DX_DEV_") console.warn(`Unrecognized value. Skipped inserting`, value);
}

function normalize(value, current, multi, doNotUnwrap) {
  value = flatten(value, { skipNonRendered: true, doNotUnwrap });
  if (doNotUnwrap && typeof value === "function") return value;
  if (multi && value != null && !Array.isArray(value)) value = [value];
  if (Array.isArray(value)) {
    for (let i = 0, len = value.length; i < len; i++) {
      const item = value[i],
        prev = current && current[i],
        t = typeof item;
      if (t === "string" || t === "number")
        value[i] =
          prev && prev.nodeType === 3 && prev.data === item ? prev : document.createTextNode(item);
    }
  }
  return value;
}

function appendNodes(parent, array, marker = null) {
  for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
}

function cleanChildren(parent, current, marker, replacement) {
  if (marker === undefined) return (parent.textContent = "");
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];
      if (replacement !== el) {
        const isParent = el.parentNode === parent;
        if (replacement && !inserted && !i)
          isParent
            ? parent.replaceChild(replacement, el)
            : parent.insertBefore(replacement, marker);
        else isParent && el.remove();
      } else inserted = true;
    }
  } else if (replacement) parent.insertBefore(replacement, marker);
}

function gatherHydratable(element, root) {
  const templates = element.querySelectorAll(`*[data-hk]`);
  for (let i = 0; i < templates.length; i++) {
    const node = templates[i];
    const key = node.getAttribute("data-hk");
    if ((!root || key.startsWith(root)) && !sharedConfig.registry.has(key))
      sharedConfig.registry.set(key, node);
  }
}

export function getHydrationKey() {
  return sharedConfig.getNextContextId();
}

export function NoHydration(props) {
  return sharedConfig.context ? undefined : props.children;
}

export function Hydration(props) {
  return props.children;
}

const voidFn = () => undefined;

// experimental
export const RequestContext = Symbol();
