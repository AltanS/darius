import { C as __toESM, S as __require, _ as withComponentProps, a as Meta, b as __commonJSMin, c as Scripts, d as isRouteErrorResponse, f as redirect, g as useRouteLoaderData, h as useRouteError, i as Links, l as ScrollRestoration, m as useRevalidator, o as NavLink, p as useLocation, r as Link, s as Outlet, t as ServerRouter, u as data, v as withErrorBoundaryProps, x as __exportAll, y as require_react } from "./chunk-H4DAEOV7-Br-5CKvD.js";
//#region node_modules/react-dom/cjs/react-dom.production.js
/**
* @license React
* react-dom.production.js
*
* Copyright (c) Meta Platforms, Inc. and affiliates.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
var require_react_dom_production = /* @__PURE__ */ __commonJSMin(((exports) => {
	var React = require_react();
	function formatProdErrorMessage(code) {
		var url = "https://react.dev/errors/" + code;
		if (1 < arguments.length) {
			url += "?args[]=" + encodeURIComponent(arguments[1]);
			for (var i = 2; i < arguments.length; i++) url += "&args[]=" + encodeURIComponent(arguments[i]);
		}
		return "Minified React error #" + code + "; visit " + url + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	function noop() {}
	var Internals = {
		d: {
			f: noop,
			r: function() {
				throw Error(formatProdErrorMessage(522));
			},
			D: noop,
			C: noop,
			L: noop,
			m: noop,
			X: noop,
			S: noop,
			M: noop
		},
		p: 0,
		findDOMNode: null
	};
	var REACT_PORTAL_TYPE = Symbol.for("react.portal");
	var REACT_RECOVERABLE_TYPE = Symbol.for("react.recoverable");
	var REACT_OPTIMISTIC_KEY = Symbol.for("react.optimistic_key");
	function createPortal$1(children, containerInfo, implementation) {
		var key = 3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
		return {
			$$typeof: REACT_PORTAL_TYPE,
			key: null == key ? null : key === REACT_OPTIMISTIC_KEY ? REACT_OPTIMISTIC_KEY : "" + key,
			children,
			containerInfo,
			implementation
		};
	}
	var ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
	function getCrossOriginStringAs(as, input) {
		if ("font" === as) return "";
		if ("string" === typeof input) return "use-credentials" === input ? input : "";
	}
	exports.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = Internals;
	exports.browser = function(reason) {
		return {
			$$typeof: REACT_RECOVERABLE_TYPE,
			_reason: reason
		};
	};
	exports.createPortal = function(children, container) {
		var key = 2 < arguments.length && void 0 !== arguments[2] ? arguments[2] : null;
		if (!container || 1 !== container.nodeType && 9 !== container.nodeType && 11 !== container.nodeType) throw Error(formatProdErrorMessage(299));
		return createPortal$1(children, container, null, key);
	};
	exports.flushSync = function(fn) {
		var previousTransition = ReactSharedInternals.T, previousUpdatePriority = Internals.p;
		try {
			if (ReactSharedInternals.T = null, Internals.p = 2, fn) return fn();
		} finally {
			ReactSharedInternals.T = previousTransition, Internals.p = previousUpdatePriority, Internals.d.f();
		}
	};
	exports.preconnect = function(href, options) {
		"string" === typeof href && (options ? (options = options.crossOrigin, options = "string" === typeof options ? "use-credentials" === options ? options : "" : void 0) : options = null, Internals.d.C(href, options));
	};
	exports.prefetchDNS = function(href) {
		"string" === typeof href && Internals.d.D(href);
	};
	exports.preinit = function(href, options) {
		if ("string" === typeof href && options && "string" === typeof options.as) {
			var as = options.as, crossOrigin = getCrossOriginStringAs(as, options.crossOrigin), integrity = "string" === typeof options.integrity ? options.integrity : void 0, fetchPriority = "string" === typeof options.fetchPriority ? options.fetchPriority : void 0;
			"style" === as ? Internals.d.S(href, "string" === typeof options.precedence ? options.precedence : void 0, {
				crossOrigin,
				integrity,
				fetchPriority
			}) : "script" === as && Internals.d.X(href, {
				crossOrigin,
				integrity,
				fetchPriority,
				nonce: "string" === typeof options.nonce ? options.nonce : void 0
			});
		}
	};
	exports.preinitModule = function(href, options) {
		if ("string" === typeof href) if ("object" === typeof options && null !== options) {
			if (null == options.as || "script" === options.as) {
				var crossOrigin = getCrossOriginStringAs(options.as, options.crossOrigin);
				Internals.d.M(href, {
					crossOrigin,
					integrity: "string" === typeof options.integrity ? options.integrity : void 0,
					nonce: "string" === typeof options.nonce ? options.nonce : void 0,
					fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0
				});
			}
		} else options ?? Internals.d.M(href);
	};
	exports.preload = function(href, options) {
		if ("string" === typeof href && "object" === typeof options && null !== options && "string" === typeof options.as) {
			var as = options.as, crossOrigin = getCrossOriginStringAs(as, options.crossOrigin);
			Internals.d.L(href, as, {
				crossOrigin,
				integrity: "string" === typeof options.integrity ? options.integrity : void 0,
				nonce: "string" === typeof options.nonce ? options.nonce : void 0,
				type: "string" === typeof options.type ? options.type : void 0,
				fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0,
				referrerPolicy: "string" === typeof options.referrerPolicy ? options.referrerPolicy : void 0,
				imageSrcSet: "string" === typeof options.imageSrcSet ? options.imageSrcSet : void 0,
				imageSizes: "string" === typeof options.imageSizes ? options.imageSizes : void 0,
				media: "string" === typeof options.media ? options.media : void 0
			});
		}
	};
	exports.preloadModule = function(href, options) {
		if ("string" === typeof href) if (options) {
			var crossOrigin = getCrossOriginStringAs(options.as, options.crossOrigin);
			Internals.d.m(href, {
				as: "string" === typeof options.as && "script" !== options.as ? options.as : void 0,
				crossOrigin,
				integrity: "string" === typeof options.integrity ? options.integrity : void 0,
				nonce: "string" === typeof options.nonce ? options.nonce : void 0,
				fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0
			});
		} else Internals.d.m(href);
	};
	exports.requestFormReset = function(form) {
		Internals.d.r(form);
	};
	exports.unstable_batchedUpdates = function(fn, a) {
		return fn(a);
	};
	exports.useFormState = function(action, initialState, permalink) {
		return ReactSharedInternals.H.useFormState(action, initialState, permalink);
	};
	exports.useFormStatus = function() {
		return ReactSharedInternals.H.useHostTransitionStatus();
	};
	exports.version = "19.3.0";
}));
//#endregion
//#region node_modules/react-dom/index.js
var require_react_dom = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	function checkDCE() {
		if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === "undefined" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== "function") return;
		try {
			__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(checkDCE);
		} catch (err) {
			console.error(err);
		}
	}
	checkDCE();
	module.exports = require_react_dom_production();
}));
//#endregion
//#region node_modules/react-dom/cjs/react-dom-server-legacy.node.production.js
/**
* @license React
* react-dom-server-legacy.node.production.js
*
* Copyright (c) Meta Platforms, Inc. and affiliates.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
var require_react_dom_server_legacy_node_production = /* @__PURE__ */ __commonJSMin(((exports) => {
	var React = require_react();
	var ReactDOM = require_react_dom();
	var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element");
	var REACT_PORTAL_TYPE = Symbol.for("react.portal");
	var REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
	var REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
	var REACT_PROFILER_TYPE = Symbol.for("react.profiler");
	var REACT_CONSUMER_TYPE = Symbol.for("react.consumer");
	var REACT_CONTEXT_TYPE = Symbol.for("react.context");
	var REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
	var REACT_SUSPENSE_TYPE = Symbol.for("react.suspense");
	var REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list");
	var REACT_MEMO_TYPE = Symbol.for("react.memo");
	var REACT_LAZY_TYPE = Symbol.for("react.lazy");
	var REACT_SCOPE_TYPE = Symbol.for("react.scope");
	var REACT_ACTIVITY_TYPE = Symbol.for("react.activity");
	var REACT_LEGACY_HIDDEN_TYPE = Symbol.for("react.legacy_hidden");
	var REACT_MEMO_CACHE_SENTINEL = Symbol.for("react.memo_cache_sentinel");
	var REACT_VIEW_TRANSITION_TYPE = Symbol.for("react.view_transition");
	var REACT_RECOVERABLE_TYPE = Symbol.for("react.recoverable");
	var MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
	function getIteratorFn(maybeIterable) {
		if (null === maybeIterable || "object" !== typeof maybeIterable) return null;
		maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
		return "function" === typeof maybeIterable ? maybeIterable : null;
	}
	var REACT_OPTIMISTIC_KEY = Symbol.for("react.optimistic_key");
	var isArrayImpl = Array.isArray;
	function murmurhash3_32_gc(key, seed) {
		var remainder = key.length & 3;
		var bytes = key.length - remainder;
		var h1 = seed;
		for (seed = 0; seed < bytes;) {
			var k1 = key.charCodeAt(seed) & 255 | (key.charCodeAt(++seed) & 255) << 8 | (key.charCodeAt(++seed) & 255) << 16 | (key.charCodeAt(++seed) & 255) << 24;
			++seed;
			k1 = 3432918353 * (k1 & 65535) + ((3432918353 * (k1 >>> 16) & 65535) << 16) & 4294967295;
			k1 = k1 << 15 | k1 >>> 17;
			k1 = 461845907 * (k1 & 65535) + ((461845907 * (k1 >>> 16) & 65535) << 16) & 4294967295;
			h1 ^= k1;
			h1 = h1 << 13 | h1 >>> 19;
			h1 = 5 * (h1 & 65535) + ((5 * (h1 >>> 16) & 65535) << 16) & 4294967295;
			h1 = (h1 & 65535) + 27492 + (((h1 >>> 16) + 58964 & 65535) << 16);
		}
		k1 = 0;
		switch (remainder) {
			case 3: k1 ^= (key.charCodeAt(seed + 2) & 255) << 16;
			case 2: k1 ^= (key.charCodeAt(seed + 1) & 255) << 8;
			case 1: k1 ^= key.charCodeAt(seed) & 255, k1 = 3432918353 * (k1 & 65535) + ((3432918353 * (k1 >>> 16) & 65535) << 16) & 4294967295, k1 = k1 << 15 | k1 >>> 17, h1 ^= 461845907 * (k1 & 65535) + ((461845907 * (k1 >>> 16) & 65535) << 16) & 4294967295;
		}
		h1 ^= key.length;
		h1 ^= h1 >>> 16;
		h1 = 2246822507 * (h1 & 65535) + ((2246822507 * (h1 >>> 16) & 65535) << 16) & 4294967295;
		h1 ^= h1 >>> 13;
		h1 = 3266489909 * (h1 & 65535) + ((3266489909 * (h1 >>> 16) & 65535) << 16) & 4294967295;
		return (h1 ^ h1 >>> 16) >>> 0;
	}
	var assign = Object.assign;
	var hasOwnProperty = Object.prototype.hasOwnProperty;
	var VALID_ATTRIBUTE_NAME_REGEX = RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$");
	var illegalAttributeNameCache = {};
	var validatedAttributeNameCache = {};
	function isAttributeNameSafe(attributeName) {
		if (hasOwnProperty.call(validatedAttributeNameCache, attributeName)) return !0;
		if (hasOwnProperty.call(illegalAttributeNameCache, attributeName)) return !1;
		if (VALID_ATTRIBUTE_NAME_REGEX.test(attributeName)) return validatedAttributeNameCache[attributeName] = !0;
		illegalAttributeNameCache[attributeName] = !0;
		return !1;
	}
	var unitlessNumbers = new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));
	var aliases = /* @__PURE__ */ new Map([
		["acceptCharset", "accept-charset"],
		["htmlFor", "for"],
		["httpEquiv", "http-equiv"],
		["crossOrigin", "crossorigin"],
		["accentHeight", "accent-height"],
		["alignmentBaseline", "alignment-baseline"],
		["arabicForm", "arabic-form"],
		["baselineShift", "baseline-shift"],
		["capHeight", "cap-height"],
		["clipPath", "clip-path"],
		["clipRule", "clip-rule"],
		["colorInterpolation", "color-interpolation"],
		["colorInterpolationFilters", "color-interpolation-filters"],
		["colorProfile", "color-profile"],
		["colorRendering", "color-rendering"],
		["dominantBaseline", "dominant-baseline"],
		["enableBackground", "enable-background"],
		["fillOpacity", "fill-opacity"],
		["fillRule", "fill-rule"],
		["floodColor", "flood-color"],
		["floodOpacity", "flood-opacity"],
		["fontFamily", "font-family"],
		["fontSize", "font-size"],
		["fontSizeAdjust", "font-size-adjust"],
		["fontStretch", "font-stretch"],
		["fontStyle", "font-style"],
		["fontVariant", "font-variant"],
		["fontWeight", "font-weight"],
		["glyphName", "glyph-name"],
		["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
		["glyphOrientationVertical", "glyph-orientation-vertical"],
		["horizAdvX", "horiz-adv-x"],
		["horizOriginX", "horiz-origin-x"],
		["imageRendering", "image-rendering"],
		["letterSpacing", "letter-spacing"],
		["lightingColor", "lighting-color"],
		["markerEnd", "marker-end"],
		["markerMid", "marker-mid"],
		["markerStart", "marker-start"],
		["maskType", "mask-type"],
		["overlinePosition", "overline-position"],
		["overlineThickness", "overline-thickness"],
		["paintOrder", "paint-order"],
		["panose-1", "panose-1"],
		["pointerEvents", "pointer-events"],
		["renderingIntent", "rendering-intent"],
		["shapeRendering", "shape-rendering"],
		["stopColor", "stop-color"],
		["stopOpacity", "stop-opacity"],
		["strikethroughPosition", "strikethrough-position"],
		["strikethroughThickness", "strikethrough-thickness"],
		["strokeDasharray", "stroke-dasharray"],
		["strokeDashoffset", "stroke-dashoffset"],
		["strokeLinecap", "stroke-linecap"],
		["strokeLinejoin", "stroke-linejoin"],
		["strokeMiterlimit", "stroke-miterlimit"],
		["strokeOpacity", "stroke-opacity"],
		["strokeWidth", "stroke-width"],
		["textAnchor", "text-anchor"],
		["textDecoration", "text-decoration"],
		["textRendering", "text-rendering"],
		["transformOrigin", "transform-origin"],
		["underlinePosition", "underline-position"],
		["underlineThickness", "underline-thickness"],
		["unicodeBidi", "unicode-bidi"],
		["unicodeRange", "unicode-range"],
		["unitsPerEm", "units-per-em"],
		["vAlphabetic", "v-alphabetic"],
		["vHanging", "v-hanging"],
		["vIdeographic", "v-ideographic"],
		["vMathematical", "v-mathematical"],
		["vectorEffect", "vector-effect"],
		["vertAdvY", "vert-adv-y"],
		["vertOriginX", "vert-origin-x"],
		["vertOriginY", "vert-origin-y"],
		["wordSpacing", "word-spacing"],
		["writingMode", "writing-mode"],
		["xmlnsXlink", "xmlns:xlink"],
		["xHeight", "x-height"]
	]);
	var matchHtmlRegExp = /["'&<>]/;
	function escapeTextForBrowser(text) {
		if ("boolean" === typeof text || "number" === typeof text || "bigint" === typeof text) return "" + text;
		text = "" + text;
		var match = matchHtmlRegExp.exec(text);
		if (match) {
			var html = "", index, lastIndex = 0;
			for (index = match.index; index < text.length; index++) {
				switch (text.charCodeAt(index)) {
					case 34:
						match = "&quot;";
						break;
					case 38:
						match = "&amp;";
						break;
					case 39:
						match = "&#x27;";
						break;
					case 60:
						match = "&lt;";
						break;
					case 62:
						match = "&gt;";
						break;
					default: continue;
				}
				lastIndex !== index && (html += text.slice(lastIndex, index));
				lastIndex = index + 1;
				html += match;
			}
			text = lastIndex !== index ? html + text.slice(lastIndex, index) : html;
		}
		return text;
	}
	var uppercasePattern = /([A-Z])/g;
	var msPattern = /^ms-/;
	var isJavaScriptProtocol = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
	function sanitizeURL(url) {
		return isJavaScriptProtocol.test("" + url) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : url;
	}
	var ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
	var ReactDOMSharedInternals = ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
	var sharedNotPendingObject = {
		pending: !1,
		data: null,
		method: null,
		action: null
	};
	var previousDispatcher = ReactDOMSharedInternals.d;
	ReactDOMSharedInternals.d = {
		f: previousDispatcher.f,
		r: previousDispatcher.r,
		D: prefetchDNS,
		C: preconnect,
		L: preload,
		m: preloadModule,
		X: preinitScript,
		S: preinitStyle,
		M: preinitModuleScript
	};
	var PRELOAD_NO_CREDS = [];
	var currentlyFlushingRenderState = null;
	var scriptRegex = /(<\/|<)(s)(cript)/gi;
	function scriptReplacer(match, prefix, s, suffix) {
		return "" + prefix + ("s" === s ? "\\u0073" : "\\u0053") + suffix;
	}
	function createResumableState(identifierPrefix, externalRuntimeConfig, bootstrapScriptContent, bootstrapScripts, bootstrapModules) {
		return {
			idPrefix: void 0 === identifierPrefix ? "" : identifierPrefix,
			nextFormID: 0,
			streamingFormat: 0,
			bootstrapScriptContent,
			bootstrapScripts,
			bootstrapModules,
			instructions: 0,
			hasBody: !1,
			hasHtml: !1,
			unknownResources: {},
			dnsResources: {},
			connectResources: {
				default: {},
				anonymous: {},
				credentials: {}
			},
			imageResources: {},
			styleResources: {},
			scriptResources: {},
			moduleUnknownResources: {},
			moduleScriptResources: {}
		};
	}
	function createFormatContext(insertionMode, selectedValue, tagScope, viewTransition) {
		return {
			insertionMode,
			selectedValue,
			tagScope,
			viewTransition
		};
	}
	function getChildFormatContext(parentContext, type, props) {
		var subtreeScope = parentContext.tagScope & -25;
		switch (type) {
			case "noscript": return createFormatContext(2, null, subtreeScope | 1, null);
			case "select": return createFormatContext(2, null != props.value ? props.value : props.defaultValue, subtreeScope, null);
			case "svg": return createFormatContext(4, null, subtreeScope, null);
			case "picture": return createFormatContext(2, null, subtreeScope | 2, null);
			case "math": return createFormatContext(5, null, subtreeScope, null);
			case "foreignObject": return createFormatContext(2, null, subtreeScope, null);
			case "table": return createFormatContext(6, null, subtreeScope, null);
			case "thead":
			case "tbody":
			case "tfoot": return createFormatContext(7, null, subtreeScope, null);
			case "colgroup": return createFormatContext(9, null, subtreeScope, null);
			case "tr": return createFormatContext(8, null, subtreeScope, null);
			case "head":
				if (2 > parentContext.insertionMode) return createFormatContext(3, null, subtreeScope, null);
				break;
			case "html": if (0 === parentContext.insertionMode) return createFormatContext(1, null, subtreeScope, null);
		}
		return 6 <= parentContext.insertionMode || 2 > parentContext.insertionMode ? createFormatContext(2, null, subtreeScope, null) : null !== parentContext.viewTransition || parentContext.tagScope !== subtreeScope ? createFormatContext(parentContext.insertionMode, parentContext.selectedValue, subtreeScope, null) : parentContext;
	}
	function getSuspenseViewTransition(parentViewTransition) {
		return null === parentViewTransition ? null : {
			update: parentViewTransition.update,
			enter: "none",
			exit: "none",
			share: parentViewTransition.update,
			parentEnter: "none",
			parentExit: "none",
			name: parentViewTransition.autoName,
			autoName: parentViewTransition.autoName,
			nameIdx: 0
		};
	}
	function getSuspenseFallbackFormatContext(resumableState, parentContext) {
		parentContext.tagScope & 32 && (resumableState.instructions |= 128);
		return createFormatContext(parentContext.insertionMode, parentContext.selectedValue, parentContext.tagScope | 12, getSuspenseViewTransition(parentContext.viewTransition));
	}
	function getSuspenseContentFormatContext(resumableState, parentContext) {
		resumableState = getSuspenseViewTransition(parentContext.viewTransition);
		var subtreeScope = parentContext.tagScope | 16;
		null !== resumableState && "none" !== resumableState.share && (subtreeScope |= 64);
		return createFormatContext(parentContext.insertionMode, parentContext.selectedValue, subtreeScope, resumableState);
	}
	function makeId(resumableState, treeId, localId) {
		resumableState = "_" + resumableState.idPrefix + "R_" + treeId;
		0 < localId && (resumableState += "H" + localId.toString(32));
		return resumableState + "_";
	}
	function pushViewTransitionAttributes(target, formatContext) {
		formatContext = formatContext.viewTransition;
		null !== formatContext && ("auto" !== formatContext.name && (pushStringAttribute(target, "vt-name", 0 === formatContext.nameIdx ? formatContext.name : formatContext.name + "_" + formatContext.nameIdx), formatContext.nameIdx++), pushStringAttribute(target, "vt-update", formatContext.update), "none" !== formatContext.enter && pushStringAttribute(target, "vt-enter", formatContext.enter), "none" !== formatContext.exit && pushStringAttribute(target, "vt-exit", formatContext.exit), "none" !== formatContext.share && pushStringAttribute(target, "vt-share", formatContext.share));
	}
	var styleNameCache = /* @__PURE__ */ new Map();
	function pushStyleAttribute(target, style) {
		if ("object" !== typeof style) throw Error("The `style` prop expects a mapping from style properties to values, not a string. For example, style={{marginRight: spacing + 'em'}} when using JSX.");
		var isFirst = !0, styleName;
		for (styleName in style) if (hasOwnProperty.call(style, styleName)) {
			var styleValue = style[styleName];
			if (null != styleValue && "boolean" !== typeof styleValue && "" !== styleValue) {
				if (0 === styleName.indexOf("--")) {
					var nameChunk = escapeTextForBrowser(styleName);
					styleValue = escapeTextForBrowser(("" + styleValue).trim());
				} else nameChunk = styleNameCache.get(styleName), void 0 === nameChunk && (nameChunk = escapeTextForBrowser(styleName.replace(uppercasePattern, "-$1").toLowerCase().replace(msPattern, "-ms-")), styleNameCache.set(styleName, nameChunk)), styleValue = "number" === typeof styleValue ? 0 === styleValue || unitlessNumbers.has(styleName) ? "" + styleValue : styleValue + "px" : escapeTextForBrowser(("" + styleValue).trim());
				isFirst ? (isFirst = !1, target.push(" style=\"", nameChunk, ":", styleValue)) : target.push(";", nameChunk, ":", styleValue);
			}
		}
		isFirst || target.push("\"");
	}
	function pushBooleanAttribute(target, name, value) {
		value && "function" !== typeof value && "symbol" !== typeof value && target.push(" ", name, "=\"\"");
	}
	function pushStringAttribute(target, name, value) {
		"function" !== typeof value && "symbol" !== typeof value && "boolean" !== typeof value && target.push(" ", name, "=\"", escapeTextForBrowser(value), "\"");
	}
	var actionJavaScriptURL = escapeTextForBrowser("javascript:throw new Error('React form unexpectedly submitted.')");
	function pushAdditionalFormField(value, key) {
		this.push("<input type=\"hidden\"");
		validateAdditionalFormField(value);
		pushStringAttribute(this, "name", key);
		pushStringAttribute(this, "value", value);
		this.push("/>");
	}
	function validateAdditionalFormField(value) {
		if ("string" !== typeof value) throw Error("File/Blob fields are not yet supported in progressive forms. Will fallback to client hydration.");
	}
	function getCustomFormFields(resumableState, formAction) {
		if ("function" === typeof formAction.$$FORM_ACTION) {
			var id = resumableState.nextFormID++;
			resumableState = resumableState.idPrefix + id;
			try {
				var customFields = formAction.$$FORM_ACTION(resumableState);
				if (customFields) customFields.data?.forEach(validateAdditionalFormField);
				return customFields;
			} catch (x) {
				if ("object" === typeof x && null !== x && "function" === typeof x.then) throw x;
			}
		}
		return null;
	}
	function pushFormActionAttribute(target, resumableState, renderState, formAction, formEncType, formMethod, formTarget, name) {
		var formData = null;
		if ("function" === typeof formAction) {
			var customFields = getCustomFormFields(resumableState, formAction);
			null !== customFields ? (name = customFields.name, formAction = customFields.action || "", formEncType = customFields.encType, formMethod = customFields.method, formTarget = customFields.target, formData = customFields.data) : (target.push(" ", "formAction", "=\"", actionJavaScriptURL, "\""), formTarget = formMethod = formEncType = formAction = name = null, injectFormReplayingRuntime(resumableState, renderState));
		}
		null != name && pushAttribute(target, "name", name);
		null != formAction && pushAttribute(target, "formAction", formAction);
		null != formEncType && pushAttribute(target, "formEncType", formEncType);
		null != formMethod && pushAttribute(target, "formMethod", formMethod);
		null != formTarget && pushAttribute(target, "formTarget", formTarget);
		return formData;
	}
	function pushAttribute(target, name, value) {
		switch (name) {
			case "className":
				pushStringAttribute(target, "class", value);
				break;
			case "tabIndex":
				pushStringAttribute(target, "tabindex", value);
				break;
			case "dir":
			case "role":
			case "viewBox":
			case "width":
			case "height":
				pushStringAttribute(target, name, value);
				break;
			case "style":
				pushStyleAttribute(target, value);
				break;
			case "src":
			case "href": if ("" === value) break;
			case "action":
			case "formAction":
				if (null == value || "function" === typeof value || "symbol" === typeof value || "boolean" === typeof value) break;
				value = sanitizeURL("" + value);
				target.push(" ", name, "=\"", escapeTextForBrowser(value), "\"");
				break;
			case "defaultValue":
			case "defaultChecked":
			case "innerHTML":
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "ref": break;
			case "autoFocus":
			case "multiple":
			case "muted":
				pushBooleanAttribute(target, name.toLowerCase(), value);
				break;
			case "xlinkHref":
				if ("function" === typeof value || "symbol" === typeof value || "boolean" === typeof value) break;
				value = sanitizeURL("" + value);
				target.push(" ", "xlink:href", "=\"", escapeTextForBrowser(value), "\"");
				break;
			case "contentEditable":
			case "spellCheck":
			case "draggable":
			case "value":
			case "autoReverse":
			case "externalResourcesRequired":
			case "focusable":
			case "preserveAlpha":
				"function" !== typeof value && "symbol" !== typeof value && target.push(" ", name, "=\"", escapeTextForBrowser(value), "\"");
				break;
			case "inert":
			case "allowFullScreen":
			case "async":
			case "autoPlay":
			case "controls":
			case "credentialless":
			case "default":
			case "defer":
			case "disabled":
			case "disablePictureInPicture":
			case "disableRemotePlayback":
			case "formNoValidate":
			case "hidden":
			case "loop":
			case "noModule":
			case "noValidate":
			case "open":
			case "playsInline":
			case "readOnly":
			case "required":
			case "reversed":
			case "scoped":
			case "seamless":
			case "itemScope":
				value && "function" !== typeof value && "symbol" !== typeof value && target.push(" ", name, "=\"\"");
				break;
			case "capture":
			case "download":
				!0 === value ? target.push(" ", name, "=\"\"") : !1 !== value && "function" !== typeof value && "symbol" !== typeof value && target.push(" ", name, "=\"", escapeTextForBrowser(value), "\"");
				break;
			case "cols":
			case "rows":
			case "size":
			case "span":
				"function" !== typeof value && "symbol" !== typeof value && !isNaN(value) && 1 <= value && target.push(" ", name, "=\"", escapeTextForBrowser(value), "\"");
				break;
			case "rowSpan":
			case "start":
				"function" === typeof value || "symbol" === typeof value || isNaN(value) || target.push(" ", name, "=\"", escapeTextForBrowser(value), "\"");
				break;
			case "xlinkActuate":
				pushStringAttribute(target, "xlink:actuate", value);
				break;
			case "xlinkArcrole":
				pushStringAttribute(target, "xlink:arcrole", value);
				break;
			case "xlinkRole":
				pushStringAttribute(target, "xlink:role", value);
				break;
			case "xlinkShow":
				pushStringAttribute(target, "xlink:show", value);
				break;
			case "xlinkTitle":
				pushStringAttribute(target, "xlink:title", value);
				break;
			case "xlinkType":
				pushStringAttribute(target, "xlink:type", value);
				break;
			case "xmlBase":
				pushStringAttribute(target, "xml:base", value);
				break;
			case "xmlLang":
				pushStringAttribute(target, "xml:lang", value);
				break;
			case "xmlSpace":
				pushStringAttribute(target, "xml:space", value);
				break;
			default: if (!(2 < name.length) || "o" !== name[0] && "O" !== name[0] || "n" !== name[1] && "N" !== name[1]) {
				if (name = aliases.get(name) || name, isAttributeNameSafe(name)) {
					switch (typeof value) {
						case "function":
						case "symbol": return;
						case "boolean":
							var prefix$8 = name.toLowerCase().slice(0, 5);
							if ("data-" !== prefix$8 && "aria-" !== prefix$8) return;
					}
					target.push(" ", name, "=\"", escapeTextForBrowser(value), "\"");
				}
			}
		}
	}
	function pushInnerHTML(target, innerHTML, children) {
		if (null != innerHTML) {
			if (null != children) throw Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
			if ("object" !== typeof innerHTML || !("__html" in innerHTML)) throw Error("`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://react.dev/link/dangerously-set-inner-html for more information.");
			innerHTML = innerHTML.__html;
			null !== innerHTML && void 0 !== innerHTML && target.push("" + innerHTML);
		}
	}
	function flattenOptionChildren(children) {
		var content = "";
		React.Children.forEach(children, function(child) {
			null != child && (content += child);
		});
		return content;
	}
	function injectFormReplayingRuntime(resumableState, renderState) {
		if (0 === (resumableState.instructions & 16)) {
			resumableState.instructions |= 16;
			var preamble = renderState.preamble, bootstrapChunks = renderState.bootstrapChunks;
			(preamble.htmlChunks || preamble.headChunks) && 0 === bootstrapChunks.length ? (bootstrapChunks.push(renderState.startInlineScript), pushCompletedShellIdAttribute(bootstrapChunks, resumableState), bootstrapChunks.push(">", "addEventListener(\"submit\",function(a){if(!a.defaultPrevented){var b=a.target,d=a.submitter,c=b.action,e=d;if(d){var f=d.getAttribute(\"formAction\");null!=f&&(c=f,e=null)}\"javascript:throw new Error('React form unexpectedly submitted.')\"===c&&(a.preventDefault(),a=new FormData(b,e),c=b.ownerDocument||b,(c.$$reactFormReplay=c.$$reactFormReplay||[]).push(b,d,a))}});", "<\/script>")) : bootstrapChunks.unshift(renderState.startInlineScript, ">", "addEventListener(\"submit\",function(a){if(!a.defaultPrevented){var b=a.target,d=a.submitter,c=b.action,e=d;if(d){var f=d.getAttribute(\"formAction\");null!=f&&(c=f,e=null)}\"javascript:throw new Error('React form unexpectedly submitted.')\"===c&&(a.preventDefault(),a=new FormData(b,e),c=b.ownerDocument||b,(c.$$reactFormReplay=c.$$reactFormReplay||[]).push(b,d,a))}});", "<\/script>");
		}
	}
	function pushLinkImpl(target, props) {
		target.push(startChunkForTag("link"));
		for (var propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
				case "dangerouslySetInnerHTML": throw Error("link is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.");
				default: pushAttribute(target, propKey, propValue);
			}
		}
		target.push("/>");
		return null;
	}
	var styleRegex = /(<\/|<)(s)(tyle)/gi;
	function styleReplacer(match, prefix, s, suffix) {
		return "" + prefix + ("s" === s ? "\\73 " : "\\53 ") + suffix;
	}
	function pushSelfClosing(target, props, tag, formatContext) {
		target.push(startChunkForTag(tag));
		for (var propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
				case "dangerouslySetInnerHTML": throw Error(tag + " is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.");
				default: pushAttribute(target, propKey, propValue);
			}
		}
		pushViewTransitionAttributes(target, formatContext);
		target.push("/>");
		return null;
	}
	function pushTitleImpl(target, props) {
		target.push(startChunkForTag("title"));
		var children = null, innerHTML = null, propKey;
		for (propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
					children = propValue;
					break;
				case "dangerouslySetInnerHTML":
					innerHTML = propValue;
					break;
				default: pushAttribute(target, propKey, propValue);
			}
		}
		target.push(">");
		props = Array.isArray(children) ? 2 > children.length ? children[0] : null : children;
		"function" !== typeof props && "symbol" !== typeof props && null !== props && void 0 !== props && target.push(escapeTextForBrowser("" + props));
		pushInnerHTML(target, innerHTML, children);
		target.push(endChunkForTag("title"));
		return null;
	}
	function pushScriptImpl(target, props) {
		target.push(startChunkForTag("script"));
		var children = null, innerHTML = null, propKey;
		for (propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
					children = propValue;
					break;
				case "dangerouslySetInnerHTML":
					innerHTML = propValue;
					break;
				default: pushAttribute(target, propKey, propValue);
			}
		}
		target.push(">");
		pushInnerHTML(target, innerHTML, children);
		"string" === typeof children && target.push(("" + children).replace(scriptRegex, scriptReplacer));
		target.push(endChunkForTag("script"));
		return null;
	}
	function pushStartSingletonElement(target, props, tag, formatContext) {
		target.push(startChunkForTag(tag));
		var innerHTML = tag = null, propKey;
		for (propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
					tag = propValue;
					break;
				case "dangerouslySetInnerHTML":
					innerHTML = propValue;
					break;
				default: pushAttribute(target, propKey, propValue);
			}
		}
		pushViewTransitionAttributes(target, formatContext);
		target.push(">");
		pushInnerHTML(target, innerHTML, tag);
		return tag;
	}
	function pushStartGenericElement(target, props, tag, formatContext) {
		target.push(startChunkForTag(tag));
		var innerHTML = tag = null, propKey;
		for (propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
					tag = propValue;
					break;
				case "dangerouslySetInnerHTML":
					innerHTML = propValue;
					break;
				default: pushAttribute(target, propKey, propValue);
			}
		}
		pushViewTransitionAttributes(target, formatContext);
		target.push(">");
		pushInnerHTML(target, innerHTML, tag);
		return "string" === typeof tag ? (target.push(escapeTextForBrowser(tag)), null) : tag;
	}
	var VALID_TAG_REGEX = /^[a-zA-Z][a-zA-Z:_\.\-\d]*$/;
	var validatedTagCache = /* @__PURE__ */ new Map();
	function startChunkForTag(tag) {
		var tagStartChunk = validatedTagCache.get(tag);
		if (void 0 === tagStartChunk) {
			if (!VALID_TAG_REGEX.test(tag)) throw Error("Invalid tag: " + tag);
			tagStartChunk = "<" + tag;
			validatedTagCache.set(tag, tagStartChunk);
		}
		return tagStartChunk;
	}
	function pushStartInstance(target$jscomp$0, type, props, resumableState, renderState, preambleState, hoistableState, formatContext, textEmbedded) {
		switch (type) {
			case "div":
			case "span":
			case "svg":
			case "path": break;
			case "a":
				target$jscomp$0.push(startChunkForTag("a"));
				var children = null, innerHTML = null, propKey;
				for (propKey in props) if (hasOwnProperty.call(props, propKey)) {
					var propValue = props[propKey];
					if (null != propValue) switch (propKey) {
						case "children":
							children = propValue;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML = propValue;
							break;
						case "href":
							"" === propValue ? pushStringAttribute(target$jscomp$0, "href", "") : pushAttribute(target$jscomp$0, propKey, propValue);
							break;
						default: pushAttribute(target$jscomp$0, propKey, propValue);
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(">");
				pushInnerHTML(target$jscomp$0, innerHTML, children);
				if ("string" === typeof children) {
					target$jscomp$0.push(escapeTextForBrowser(children));
					var JSCompiler_inline_result = null;
				} else JSCompiler_inline_result = children;
				return JSCompiler_inline_result;
			case "g":
			case "p":
			case "li": break;
			case "select":
				target$jscomp$0.push(startChunkForTag("select"));
				var children$jscomp$0 = null, innerHTML$jscomp$0 = null, propKey$jscomp$0;
				for (propKey$jscomp$0 in props) if (hasOwnProperty.call(props, propKey$jscomp$0)) {
					var propValue$jscomp$0 = props[propKey$jscomp$0];
					if (null != propValue$jscomp$0) switch (propKey$jscomp$0) {
						case "children":
							children$jscomp$0 = propValue$jscomp$0;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$0 = propValue$jscomp$0;
							break;
						case "defaultValue":
						case "value": break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$0, propValue$jscomp$0);
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(">");
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$0, children$jscomp$0);
				return children$jscomp$0;
			case "option":
				var selectedValue = formatContext.selectedValue;
				target$jscomp$0.push(startChunkForTag("option"));
				var children$jscomp$1 = null, value = null, selected = null, innerHTML$jscomp$1 = null, propKey$jscomp$1;
				for (propKey$jscomp$1 in props) if (hasOwnProperty.call(props, propKey$jscomp$1)) {
					var propValue$jscomp$1 = props[propKey$jscomp$1];
					if (null != propValue$jscomp$1) switch (propKey$jscomp$1) {
						case "children":
							children$jscomp$1 = propValue$jscomp$1;
							break;
						case "selected":
							selected = propValue$jscomp$1;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$1 = propValue$jscomp$1;
							break;
						case "value": value = propValue$jscomp$1;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$1, propValue$jscomp$1);
					}
				}
				if (null != selectedValue) {
					var stringValue = null !== value ? "" + value : flattenOptionChildren(children$jscomp$1);
					if (isArrayImpl(selectedValue)) {
						for (var i = 0; i < selectedValue.length; i++) if ("" + selectedValue[i] === stringValue) {
							target$jscomp$0.push(" selected=\"\"");
							break;
						}
					} else "" + selectedValue === stringValue && target$jscomp$0.push(" selected=\"\"");
				} else selected && target$jscomp$0.push(" selected=\"\"");
				target$jscomp$0.push(">");
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$1, children$jscomp$1);
				return children$jscomp$1;
			case "textarea":
				target$jscomp$0.push(startChunkForTag("textarea"));
				var value$jscomp$0 = null, defaultValue = null, children$jscomp$2 = null, propKey$jscomp$2;
				for (propKey$jscomp$2 in props) if (hasOwnProperty.call(props, propKey$jscomp$2)) {
					var propValue$jscomp$2 = props[propKey$jscomp$2];
					if (null != propValue$jscomp$2) switch (propKey$jscomp$2) {
						case "children":
							children$jscomp$2 = propValue$jscomp$2;
							break;
						case "value":
							value$jscomp$0 = propValue$jscomp$2;
							break;
						case "defaultValue":
							defaultValue = propValue$jscomp$2;
							break;
						case "dangerouslySetInnerHTML": throw Error("`dangerouslySetInnerHTML` does not make sense on <textarea>.");
						default: pushAttribute(target$jscomp$0, propKey$jscomp$2, propValue$jscomp$2);
					}
				}
				null === value$jscomp$0 && null !== defaultValue && (value$jscomp$0 = defaultValue);
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(">");
				if (null != children$jscomp$2) {
					if (null != value$jscomp$0) throw Error("If you supply `defaultValue` on a <textarea>, do not pass children.");
					if (isArrayImpl(children$jscomp$2)) {
						if (1 < children$jscomp$2.length) throw Error("<textarea> can only have at most one child.");
						value$jscomp$0 = "" + children$jscomp$2[0];
					}
					value$jscomp$0 = "" + children$jscomp$2;
				}
				"string" === typeof value$jscomp$0 && "\n" === value$jscomp$0[0] && target$jscomp$0.push("\n");
				null !== value$jscomp$0 && target$jscomp$0.push(escapeTextForBrowser("" + value$jscomp$0));
				return null;
			case "input":
				target$jscomp$0.push(startChunkForTag("input"));
				var name = null, formAction = null, formEncType = null, formMethod = null, formTarget = null, value$jscomp$1 = null, defaultValue$jscomp$0 = null, checked = null, defaultChecked = null, propKey$jscomp$3;
				for (propKey$jscomp$3 in props) if (hasOwnProperty.call(props, propKey$jscomp$3)) {
					var propValue$jscomp$3 = props[propKey$jscomp$3];
					if (null != propValue$jscomp$3) switch (propKey$jscomp$3) {
						case "children":
						case "dangerouslySetInnerHTML": throw Error("input is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.");
						case "name":
							name = propValue$jscomp$3;
							break;
						case "formAction":
							formAction = propValue$jscomp$3;
							break;
						case "formEncType":
							formEncType = propValue$jscomp$3;
							break;
						case "formMethod":
							formMethod = propValue$jscomp$3;
							break;
						case "formTarget":
							formTarget = propValue$jscomp$3;
							break;
						case "defaultChecked":
							defaultChecked = propValue$jscomp$3;
							break;
						case "defaultValue":
							defaultValue$jscomp$0 = propValue$jscomp$3;
							break;
						case "checked":
							checked = propValue$jscomp$3;
							break;
						case "value":
							value$jscomp$1 = propValue$jscomp$3;
							break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$3, propValue$jscomp$3);
					}
				}
				var formData = pushFormActionAttribute(target$jscomp$0, resumableState, renderState, formAction, formEncType, formMethod, formTarget, name);
				null !== checked ? pushBooleanAttribute(target$jscomp$0, "checked", checked) : null !== defaultChecked && pushBooleanAttribute(target$jscomp$0, "checked", defaultChecked);
				null !== value$jscomp$1 ? pushAttribute(target$jscomp$0, "value", value$jscomp$1) : null !== defaultValue$jscomp$0 && pushAttribute(target$jscomp$0, "value", defaultValue$jscomp$0);
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push("/>");
				formData?.forEach(pushAdditionalFormField, target$jscomp$0);
				return null;
			case "button":
				target$jscomp$0.push(startChunkForTag("button"));
				var children$jscomp$3 = null, innerHTML$jscomp$2 = null, name$jscomp$0 = null, formAction$jscomp$0 = null, formEncType$jscomp$0 = null, formMethod$jscomp$0 = null, formTarget$jscomp$0 = null, propKey$jscomp$4;
				for (propKey$jscomp$4 in props) if (hasOwnProperty.call(props, propKey$jscomp$4)) {
					var propValue$jscomp$4 = props[propKey$jscomp$4];
					if (null != propValue$jscomp$4) switch (propKey$jscomp$4) {
						case "children":
							children$jscomp$3 = propValue$jscomp$4;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$2 = propValue$jscomp$4;
							break;
						case "name":
							name$jscomp$0 = propValue$jscomp$4;
							break;
						case "formAction":
							formAction$jscomp$0 = propValue$jscomp$4;
							break;
						case "formEncType":
							formEncType$jscomp$0 = propValue$jscomp$4;
							break;
						case "formMethod":
							formMethod$jscomp$0 = propValue$jscomp$4;
							break;
						case "formTarget":
							formTarget$jscomp$0 = propValue$jscomp$4;
							break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$4, propValue$jscomp$4);
					}
				}
				var formData$jscomp$0 = pushFormActionAttribute(target$jscomp$0, resumableState, renderState, formAction$jscomp$0, formEncType$jscomp$0, formMethod$jscomp$0, formTarget$jscomp$0, name$jscomp$0);
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(">");
				formData$jscomp$0?.forEach(pushAdditionalFormField, target$jscomp$0);
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$2, children$jscomp$3);
				if ("string" === typeof children$jscomp$3) {
					target$jscomp$0.push(escapeTextForBrowser(children$jscomp$3));
					var JSCompiler_inline_result$jscomp$0 = null;
				} else JSCompiler_inline_result$jscomp$0 = children$jscomp$3;
				return JSCompiler_inline_result$jscomp$0;
			case "form":
				target$jscomp$0.push(startChunkForTag("form"));
				var children$jscomp$4 = null, innerHTML$jscomp$3 = null, formAction$jscomp$1 = null, formEncType$jscomp$1 = null, formMethod$jscomp$1 = null, formTarget$jscomp$1 = null, propKey$jscomp$5;
				for (propKey$jscomp$5 in props) if (hasOwnProperty.call(props, propKey$jscomp$5)) {
					var propValue$jscomp$5 = props[propKey$jscomp$5];
					if (null != propValue$jscomp$5) switch (propKey$jscomp$5) {
						case "children":
							children$jscomp$4 = propValue$jscomp$5;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$3 = propValue$jscomp$5;
							break;
						case "action":
							formAction$jscomp$1 = propValue$jscomp$5;
							break;
						case "encType":
							formEncType$jscomp$1 = propValue$jscomp$5;
							break;
						case "method":
							formMethod$jscomp$1 = propValue$jscomp$5;
							break;
						case "target":
							formTarget$jscomp$1 = propValue$jscomp$5;
							break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$5, propValue$jscomp$5);
					}
				}
				var formData$jscomp$1 = null, formActionName = null;
				if ("function" === typeof formAction$jscomp$1) {
					var customFields = getCustomFormFields(resumableState, formAction$jscomp$1);
					null !== customFields ? (formAction$jscomp$1 = customFields.action || "", formEncType$jscomp$1 = customFields.encType, formMethod$jscomp$1 = customFields.method, formTarget$jscomp$1 = customFields.target, formData$jscomp$1 = customFields.data, formActionName = customFields.name) : (target$jscomp$0.push(" ", "action", "=\"", actionJavaScriptURL, "\""), formTarget$jscomp$1 = formMethod$jscomp$1 = formEncType$jscomp$1 = formAction$jscomp$1 = null, injectFormReplayingRuntime(resumableState, renderState));
				}
				null != formAction$jscomp$1 && pushAttribute(target$jscomp$0, "action", formAction$jscomp$1);
				null != formEncType$jscomp$1 && pushAttribute(target$jscomp$0, "encType", formEncType$jscomp$1);
				null != formMethod$jscomp$1 && pushAttribute(target$jscomp$0, "method", formMethod$jscomp$1);
				null != formTarget$jscomp$1 && pushAttribute(target$jscomp$0, "target", formTarget$jscomp$1);
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(">");
				null !== formActionName && (target$jscomp$0.push("<input type=\"hidden\""), pushStringAttribute(target$jscomp$0, "name", formActionName), target$jscomp$0.push("/>"), formData$jscomp$1?.forEach(pushAdditionalFormField, target$jscomp$0));
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$3, children$jscomp$4);
				if ("string" === typeof children$jscomp$4) {
					target$jscomp$0.push(escapeTextForBrowser(children$jscomp$4));
					var JSCompiler_inline_result$jscomp$1 = null;
				} else JSCompiler_inline_result$jscomp$1 = children$jscomp$4;
				return JSCompiler_inline_result$jscomp$1;
			case "menuitem":
				target$jscomp$0.push(startChunkForTag("menuitem"));
				for (var propKey$jscomp$6 in props) if (hasOwnProperty.call(props, propKey$jscomp$6)) {
					var propValue$jscomp$6 = props[propKey$jscomp$6];
					if (null != propValue$jscomp$6) switch (propKey$jscomp$6) {
						case "children":
						case "dangerouslySetInnerHTML": throw Error("menuitems cannot have `children` nor `dangerouslySetInnerHTML`.");
						default: pushAttribute(target$jscomp$0, propKey$jscomp$6, propValue$jscomp$6);
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(">");
				return null;
			case "object":
				target$jscomp$0.push(startChunkForTag("object"));
				var children$jscomp$5 = null, innerHTML$jscomp$4 = null, propKey$jscomp$7;
				for (propKey$jscomp$7 in props) if (hasOwnProperty.call(props, propKey$jscomp$7)) {
					var propValue$jscomp$7 = props[propKey$jscomp$7];
					if (null != propValue$jscomp$7) switch (propKey$jscomp$7) {
						case "children":
							children$jscomp$5 = propValue$jscomp$7;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$4 = propValue$jscomp$7;
							break;
						case "data":
							var sanitizedValue = sanitizeURL("" + propValue$jscomp$7);
							if ("" === sanitizedValue) break;
							target$jscomp$0.push(" ", "data", "=\"", escapeTextForBrowser(sanitizedValue), "\"");
							break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$7, propValue$jscomp$7);
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(">");
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$4, children$jscomp$5);
				if ("string" === typeof children$jscomp$5) {
					target$jscomp$0.push(escapeTextForBrowser(children$jscomp$5));
					var JSCompiler_inline_result$jscomp$2 = null;
				} else JSCompiler_inline_result$jscomp$2 = children$jscomp$5;
				return JSCompiler_inline_result$jscomp$2;
			case "title":
				var noscriptTagInScope = formatContext.tagScope & 1, isFallback = formatContext.tagScope & 4;
				if (4 === formatContext.insertionMode || noscriptTagInScope || null != props.itemProp) var JSCompiler_inline_result$jscomp$3 = pushTitleImpl(target$jscomp$0, props);
				else isFallback ? JSCompiler_inline_result$jscomp$3 = null : (pushTitleImpl(renderState.hoistableChunks, props), JSCompiler_inline_result$jscomp$3 = void 0);
				return JSCompiler_inline_result$jscomp$3;
			case "link":
				var noscriptTagInScope$jscomp$0 = formatContext.tagScope & 1, isFallback$jscomp$0 = formatContext.tagScope & 4, rel = props.rel, href = props.href, precedence = props.precedence;
				if (4 === formatContext.insertionMode || noscriptTagInScope$jscomp$0 || null != props.itemProp || "string" !== typeof rel || "string" !== typeof href || "" === href) {
					pushLinkImpl(target$jscomp$0, props);
					var JSCompiler_inline_result$jscomp$4 = null;
				} else if ("stylesheet" === props.rel) if ("string" !== typeof precedence || null != props.disabled || props.onLoad || props.onError) JSCompiler_inline_result$jscomp$4 = pushLinkImpl(target$jscomp$0, props);
				else {
					var styleQueue = renderState.styles.get(precedence), resourceState = resumableState.styleResources.hasOwnProperty(href) ? resumableState.styleResources[href] : void 0;
					if (null !== resourceState) {
						resumableState.styleResources[href] = null;
						styleQueue || (styleQueue = {
							precedence: escapeTextForBrowser(precedence),
							rules: [],
							hrefs: [],
							sheets: /* @__PURE__ */ new Map()
						}, renderState.styles.set(precedence, styleQueue));
						var resource = {
							state: 0,
							props: assign({}, props, {
								"data-precedence": props.precedence,
								precedence: null
							})
						};
						if (resourceState) {
							2 === resourceState.length && adoptPreloadCredentials(resource.props, resourceState);
							var preloadResource = renderState.preloads.stylesheets.get(href);
							preloadResource && 0 < preloadResource.length ? preloadResource.length = 0 : resource.state = 1;
						}
						styleQueue.sheets.set(href, resource);
						hoistableState && hoistableState.stylesheets.add(resource);
					} else if (styleQueue) {
						var resource$9 = styleQueue.sheets.get(href);
						resource$9 && hoistableState && hoistableState.stylesheets.add(resource$9);
					}
					textEmbedded && target$jscomp$0.push("<!-- -->");
					JSCompiler_inline_result$jscomp$4 = null;
				}
				else props.onLoad || props.onError ? JSCompiler_inline_result$jscomp$4 = pushLinkImpl(target$jscomp$0, props) : (textEmbedded && target$jscomp$0.push("<!-- -->"), JSCompiler_inline_result$jscomp$4 = isFallback$jscomp$0 ? null : pushLinkImpl(renderState.hoistableChunks, props));
				return JSCompiler_inline_result$jscomp$4;
			case "script":
				var noscriptTagInScope$jscomp$1 = formatContext.tagScope & 1, asyncProp = props.async;
				if ("string" !== typeof props.src || !props.src || !asyncProp || "function" === typeof asyncProp || "symbol" === typeof asyncProp || props.onLoad || props.onError || 4 === formatContext.insertionMode || noscriptTagInScope$jscomp$1 || null != props.itemProp) var JSCompiler_inline_result$jscomp$5 = pushScriptImpl(target$jscomp$0, props);
				else {
					var key = props.src;
					if ("module" === props.type) {
						var resources = resumableState.moduleScriptResources;
						var preloads = renderState.preloads.moduleScripts;
					} else resources = resumableState.scriptResources, preloads = renderState.preloads.scripts;
					var resourceState$jscomp$0 = resources.hasOwnProperty(key) ? resources[key] : void 0;
					if (null !== resourceState$jscomp$0) {
						resources[key] = null;
						var scriptProps = props;
						if (resourceState$jscomp$0) {
							2 === resourceState$jscomp$0.length && (scriptProps = assign({}, props), adoptPreloadCredentials(scriptProps, resourceState$jscomp$0));
							var preloadResource$jscomp$0 = preloads.get(key);
							preloadResource$jscomp$0 && (preloadResource$jscomp$0.length = 0);
						}
						var resource$jscomp$0 = [];
						renderState.scripts.add(resource$jscomp$0);
						pushScriptImpl(resource$jscomp$0, scriptProps);
					}
					textEmbedded && target$jscomp$0.push("<!-- -->");
					JSCompiler_inline_result$jscomp$5 = null;
				}
				return JSCompiler_inline_result$jscomp$5;
			case "style":
				var noscriptTagInScope$jscomp$2 = formatContext.tagScope & 1, precedence$jscomp$0 = props.precedence, href$jscomp$0 = props.href, nonce = props.nonce;
				if (4 === formatContext.insertionMode || noscriptTagInScope$jscomp$2 || null != props.itemProp || "string" !== typeof precedence$jscomp$0 || "string" !== typeof href$jscomp$0 || "" === href$jscomp$0) {
					target$jscomp$0.push(startChunkForTag("style"));
					var children$jscomp$6 = null, innerHTML$jscomp$5 = null, propKey$jscomp$8;
					for (propKey$jscomp$8 in props) if (hasOwnProperty.call(props, propKey$jscomp$8)) {
						var propValue$jscomp$8 = props[propKey$jscomp$8];
						if (null != propValue$jscomp$8) switch (propKey$jscomp$8) {
							case "children":
								children$jscomp$6 = propValue$jscomp$8;
								break;
							case "dangerouslySetInnerHTML":
								innerHTML$jscomp$5 = propValue$jscomp$8;
								break;
							default: pushAttribute(target$jscomp$0, propKey$jscomp$8, propValue$jscomp$8);
						}
					}
					target$jscomp$0.push(">");
					var child = Array.isArray(children$jscomp$6) ? 2 > children$jscomp$6.length ? children$jscomp$6[0] : null : children$jscomp$6;
					"function" !== typeof child && "symbol" !== typeof child && null !== child && void 0 !== child && target$jscomp$0.push(("" + child).replace(styleRegex, styleReplacer));
					pushInnerHTML(target$jscomp$0, innerHTML$jscomp$5, children$jscomp$6);
					target$jscomp$0.push(endChunkForTag("style"));
					var JSCompiler_inline_result$jscomp$6 = null;
				} else {
					var styleQueue$jscomp$0 = renderState.styles.get(precedence$jscomp$0);
					if (null !== (resumableState.styleResources.hasOwnProperty(href$jscomp$0) ? resumableState.styleResources[href$jscomp$0] : void 0)) {
						resumableState.styleResources[href$jscomp$0] = null;
						styleQueue$jscomp$0 || (styleQueue$jscomp$0 = {
							precedence: escapeTextForBrowser(precedence$jscomp$0),
							rules: [],
							hrefs: [],
							sheets: /* @__PURE__ */ new Map()
						}, renderState.styles.set(precedence$jscomp$0, styleQueue$jscomp$0));
						var nonceStyle = renderState.nonce.style;
						if (!nonceStyle || nonceStyle === nonce) {
							styleQueue$jscomp$0.hrefs.push(escapeTextForBrowser(href$jscomp$0));
							var target = styleQueue$jscomp$0.rules, children$jscomp$7 = null, innerHTML$jscomp$6 = null, propKey$jscomp$9;
							for (propKey$jscomp$9 in props) if (hasOwnProperty.call(props, propKey$jscomp$9)) {
								var propValue$jscomp$9 = props[propKey$jscomp$9];
								if (null != propValue$jscomp$9) switch (propKey$jscomp$9) {
									case "children":
										children$jscomp$7 = propValue$jscomp$9;
										break;
									case "dangerouslySetInnerHTML": innerHTML$jscomp$6 = propValue$jscomp$9;
								}
							}
							var child$jscomp$0 = Array.isArray(children$jscomp$7) ? 2 > children$jscomp$7.length ? children$jscomp$7[0] : null : children$jscomp$7;
							"function" !== typeof child$jscomp$0 && "symbol" !== typeof child$jscomp$0 && null !== child$jscomp$0 && void 0 !== child$jscomp$0 && target.push(("" + child$jscomp$0).replace(styleRegex, styleReplacer));
							pushInnerHTML(target, innerHTML$jscomp$6, children$jscomp$7);
						}
					}
					styleQueue$jscomp$0 && hoistableState && hoistableState.styles.add(styleQueue$jscomp$0);
					textEmbedded && target$jscomp$0.push("<!-- -->");
					JSCompiler_inline_result$jscomp$6 = void 0;
				}
				return JSCompiler_inline_result$jscomp$6;
			case "meta":
				var noscriptTagInScope$jscomp$3 = formatContext.tagScope & 1, isFallback$jscomp$1 = formatContext.tagScope & 4;
				if (4 === formatContext.insertionMode || noscriptTagInScope$jscomp$3 || null != props.itemProp) var JSCompiler_inline_result$jscomp$7 = pushSelfClosing(target$jscomp$0, props, "meta", formatContext);
				else textEmbedded && target$jscomp$0.push("<!-- -->"), JSCompiler_inline_result$jscomp$7 = isFallback$jscomp$1 ? null : "string" === typeof props.charSet ? pushSelfClosing(renderState.charsetChunks, props, "meta", formatContext) : "viewport" === props.name ? pushSelfClosing(renderState.viewportChunks, props, "meta", formatContext) : pushSelfClosing(renderState.hoistableChunks, props, "meta", formatContext);
				return JSCompiler_inline_result$jscomp$7;
			case "listing":
			case "pre":
				target$jscomp$0.push(startChunkForTag(type));
				var children$jscomp$8 = null, innerHTML$jscomp$7 = null, propKey$jscomp$10;
				for (propKey$jscomp$10 in props) if (hasOwnProperty.call(props, propKey$jscomp$10)) {
					var propValue$jscomp$10 = props[propKey$jscomp$10];
					if (null != propValue$jscomp$10) switch (propKey$jscomp$10) {
						case "children":
							children$jscomp$8 = propValue$jscomp$10;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$7 = propValue$jscomp$10;
							break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$10, propValue$jscomp$10);
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(">");
				if (null != innerHTML$jscomp$7) {
					if (null != children$jscomp$8) throw Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
					if ("object" !== typeof innerHTML$jscomp$7 || !("__html" in innerHTML$jscomp$7)) throw Error("`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://react.dev/link/dangerously-set-inner-html for more information.");
					var html = innerHTML$jscomp$7.__html;
					null !== html && void 0 !== html && ("string" === typeof html && 0 < html.length && "\n" === html[0] ? target$jscomp$0.push("\n", html) : target$jscomp$0.push("" + html));
				}
				"string" === typeof children$jscomp$8 && "\n" === children$jscomp$8[0] && target$jscomp$0.push("\n");
				return children$jscomp$8;
			case "img":
				var pictureOrNoScriptTagInScope = formatContext.tagScope & 3, src = props.src, srcSet = props.srcSet;
				if (!("lazy" === props.loading || !src && !srcSet || "string" !== typeof src && null != src || "string" !== typeof srcSet && null != srcSet || "low" === props.fetchPriority || pictureOrNoScriptTagInScope) && ("string" !== typeof src || ":" !== src[4] || "d" !== src[0] && "D" !== src[0] || "a" !== src[1] && "A" !== src[1] || "t" !== src[2] && "T" !== src[2] || "a" !== src[3] && "A" !== src[3]) && ("string" !== typeof srcSet || ":" !== srcSet[4] || "d" !== srcSet[0] && "D" !== srcSet[0] || "a" !== srcSet[1] && "A" !== srcSet[1] || "t" !== srcSet[2] && "T" !== srcSet[2] || "a" !== srcSet[3] && "A" !== srcSet[3])) {
					null !== hoistableState && formatContext.tagScope & 64 && (hoistableState.suspenseyImages = !0);
					var sizes = "string" === typeof props.sizes ? props.sizes : void 0, key$jscomp$0 = srcSet ? srcSet + "\n" + (sizes || "") : src, promotablePreloads = renderState.preloads.images, resource$jscomp$1 = promotablePreloads.get(key$jscomp$0);
					if (resource$jscomp$1) {
						if ("high" === props.fetchPriority || 10 > renderState.highImagePreloads.size) promotablePreloads.delete(key$jscomp$0), renderState.highImagePreloads.add(resource$jscomp$1);
					} else if (!resumableState.imageResources.hasOwnProperty(key$jscomp$0)) {
						resumableState.imageResources[key$jscomp$0] = PRELOAD_NO_CREDS;
						var input = props.crossOrigin;
						var JSCompiler_inline_result$jscomp$8 = "string" === typeof input ? "use-credentials" === input ? input : "" : void 0;
						var headers = renderState.headers, header;
						headers && 0 < headers.remainingCapacity && "string" !== typeof props.srcSet && ("high" === props.fetchPriority || 500 > headers.highImagePreloads.length) && (header = getPreloadAsHeader(src, "image", {
							imageSrcSet: props.srcSet,
							imageSizes: props.sizes,
							crossOrigin: JSCompiler_inline_result$jscomp$8,
							integrity: props.integrity,
							nonce: props.nonce,
							type: props.type,
							fetchPriority: props.fetchPriority,
							referrerPolicy: props.referrerPolicy
						}), 0 <= (headers.remainingCapacity -= header.length + 2)) ? (renderState.resets.image[key$jscomp$0] = PRELOAD_NO_CREDS, headers.highImagePreloads && (headers.highImagePreloads += ", "), headers.highImagePreloads += header) : (resource$jscomp$1 = [], pushLinkImpl(resource$jscomp$1, {
							rel: "preload",
							as: "image",
							href: srcSet ? void 0 : src,
							imageSrcSet: srcSet,
							imageSizes: sizes,
							crossOrigin: JSCompiler_inline_result$jscomp$8,
							integrity: props.integrity,
							type: props.type,
							fetchPriority: props.fetchPriority,
							referrerPolicy: props.referrerPolicy
						}), "high" === props.fetchPriority || 10 > renderState.highImagePreloads.size ? renderState.highImagePreloads.add(resource$jscomp$1) : (renderState.bulkPreloads.add(resource$jscomp$1), promotablePreloads.set(key$jscomp$0, resource$jscomp$1)));
					}
				}
				return pushSelfClosing(target$jscomp$0, props, "img", formatContext);
			case "base":
			case "area":
			case "br":
			case "col":
			case "embed":
			case "hr":
			case "keygen":
			case "param":
			case "source":
			case "track":
			case "wbr": return pushSelfClosing(target$jscomp$0, props, type, formatContext);
			case "annotation-xml":
			case "color-profile":
			case "font-face":
			case "font-face-src":
			case "font-face-uri":
			case "font-face-format":
			case "font-face-name":
			case "missing-glyph": break;
			case "head":
				if (2 > formatContext.insertionMode) {
					var preamble = preambleState || renderState.preamble;
					if (preamble.headChunks) throw Error("The `<head>` tag may only be rendered once.");
					null !== preambleState && target$jscomp$0.push("<!--head-->");
					preamble.headChunks = [];
					var JSCompiler_inline_result$jscomp$9 = pushStartSingletonElement(preamble.headChunks, props, "head", formatContext);
				} else JSCompiler_inline_result$jscomp$9 = pushStartGenericElement(target$jscomp$0, props, "head", formatContext);
				return JSCompiler_inline_result$jscomp$9;
			case "body":
				if (2 > formatContext.insertionMode) {
					var preamble$jscomp$0 = preambleState || renderState.preamble;
					if (preamble$jscomp$0.bodyChunks) throw Error("The `<body>` tag may only be rendered once.");
					null !== preambleState && target$jscomp$0.push("<!--body-->");
					preamble$jscomp$0.bodyChunks = [];
					var JSCompiler_inline_result$jscomp$10 = pushStartSingletonElement(preamble$jscomp$0.bodyChunks, props, "body", formatContext);
				} else JSCompiler_inline_result$jscomp$10 = pushStartGenericElement(target$jscomp$0, props, "body", formatContext);
				return JSCompiler_inline_result$jscomp$10;
			case "html":
				if (0 === formatContext.insertionMode) {
					var preamble$jscomp$1 = preambleState || renderState.preamble;
					if (preamble$jscomp$1.htmlChunks) throw Error("The `<html>` tag may only be rendered once.");
					null !== preambleState && target$jscomp$0.push("<!--html-->");
					preamble$jscomp$1.htmlChunks = [""];
					var JSCompiler_inline_result$jscomp$11 = pushStartSingletonElement(preamble$jscomp$1.htmlChunks, props, "html", formatContext);
				} else JSCompiler_inline_result$jscomp$11 = pushStartGenericElement(target$jscomp$0, props, "html", formatContext);
				return JSCompiler_inline_result$jscomp$11;
			default: if (-1 !== type.indexOf("-")) {
				target$jscomp$0.push(startChunkForTag(type));
				var children$jscomp$9 = null, innerHTML$jscomp$8 = null, propKey$jscomp$11;
				for (propKey$jscomp$11 in props) if (hasOwnProperty.call(props, propKey$jscomp$11)) {
					var propValue$jscomp$11 = props[propKey$jscomp$11];
					if (null != propValue$jscomp$11) {
						var attributeName = propKey$jscomp$11;
						switch (propKey$jscomp$11) {
							case "children":
								children$jscomp$9 = propValue$jscomp$11;
								break;
							case "dangerouslySetInnerHTML":
								innerHTML$jscomp$8 = propValue$jscomp$11;
								break;
							case "style":
								pushStyleAttribute(target$jscomp$0, propValue$jscomp$11);
								break;
							case "suppressContentEditableWarning":
							case "suppressHydrationWarning":
							case "ref": break;
							case "className": attributeName = "class";
							default: if (isAttributeNameSafe(propKey$jscomp$11) && "function" !== typeof propValue$jscomp$11 && "symbol" !== typeof propValue$jscomp$11 && !1 !== propValue$jscomp$11) {
								if (!0 === propValue$jscomp$11) propValue$jscomp$11 = "";
								else if ("object" === typeof propValue$jscomp$11) continue;
								target$jscomp$0.push(" ", attributeName, "=\"", escapeTextForBrowser(propValue$jscomp$11), "\"");
							}
						}
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(">");
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$8, children$jscomp$9);
				return children$jscomp$9;
			}
		}
		return pushStartGenericElement(target$jscomp$0, props, type, formatContext);
	}
	var endTagCache = /* @__PURE__ */ new Map();
	function endChunkForTag(tag) {
		var chunk = endTagCache.get(tag);
		void 0 === chunk && (chunk = "</" + tag + ">", endTagCache.set(tag, chunk));
		return chunk;
	}
	function hoistPreambleState(renderState, preambleState) {
		renderState = renderState.preamble;
		null === renderState.htmlChunks && preambleState.htmlChunks && (renderState.htmlChunks = preambleState.htmlChunks);
		null === renderState.headChunks && preambleState.headChunks && (renderState.headChunks = preambleState.headChunks);
		null === renderState.bodyChunks && preambleState.bodyChunks && (renderState.bodyChunks = preambleState.bodyChunks);
	}
	function writeBootstrap(destination, renderState) {
		renderState = renderState.bootstrapChunks;
		for (var i = 0; i < renderState.length - 1; i++) destination.push(renderState[i]);
		return i < renderState.length ? (i = renderState[i], renderState.length = 0, destination.push(i)) : !0;
	}
	function writeStartPendingSuspenseBoundary(destination, renderState, id) {
		destination.push("<!--$?--><template id=\"");
		if (null === id) throw Error("An ID must have been assigned before we can complete the boundary.");
		destination.push(renderState.boundaryPrefix);
		renderState = id.toString(16);
		destination.push(renderState);
		return destination.push("\"></template>");
	}
	function writeStartSegment(destination, renderState, formatContext, id) {
		switch (formatContext.insertionMode) {
			case 0:
			case 1:
			case 3:
			case 2: return destination.push("<div hidden id=\""), destination.push(renderState.segmentPrefix), renderState = id.toString(16), destination.push(renderState), destination.push("\">");
			case 4: return destination.push("<svg aria-hidden=\"true\" style=\"display:none\" id=\""), destination.push(renderState.segmentPrefix), renderState = id.toString(16), destination.push(renderState), destination.push("\">");
			case 5: return destination.push("<math aria-hidden=\"true\" style=\"display:none\" id=\""), destination.push(renderState.segmentPrefix), renderState = id.toString(16), destination.push(renderState), destination.push("\">");
			case 6: return destination.push("<table hidden id=\""), destination.push(renderState.segmentPrefix), renderState = id.toString(16), destination.push(renderState), destination.push("\">");
			case 7: return destination.push("<table hidden><tbody id=\""), destination.push(renderState.segmentPrefix), renderState = id.toString(16), destination.push(renderState), destination.push("\">");
			case 8: return destination.push("<table hidden><tr id=\""), destination.push(renderState.segmentPrefix), renderState = id.toString(16), destination.push(renderState), destination.push("\">");
			case 9: return destination.push("<table hidden><colgroup id=\""), destination.push(renderState.segmentPrefix), renderState = id.toString(16), destination.push(renderState), destination.push("\">");
			default: throw Error("Unknown insertion mode. This is a bug in React.");
		}
	}
	function writeEndSegment(destination, formatContext) {
		switch (formatContext.insertionMode) {
			case 0:
			case 1:
			case 3:
			case 2: return destination.push("</div>");
			case 4: return destination.push("</svg>");
			case 5: return destination.push("</math>");
			case 6: return destination.push("</table>");
			case 7: return destination.push("</tbody></table>");
			case 8: return destination.push("</tr></table>");
			case 9: return destination.push("</colgroup></table>");
			default: throw Error("Unknown insertion mode. This is a bug in React.");
		}
	}
	var regexForJSStringsInInstructionScripts = /[<\u2028\u2029]/g;
	function escapeJSStringsForInstructionScripts(input) {
		return JSON.stringify(input).replace(regexForJSStringsInInstructionScripts, function(match) {
			switch (match) {
				case "<": return "\\u003c";
				case "\u2028": return "\\u2028";
				case "\u2029": return "\\u2029";
				default: throw Error("escapeJSStringsForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React");
			}
		});
	}
	var regexForJSStringsInScripts = /[&><\u2028\u2029]/g;
	function escapeJSObjectForInstructionScripts(input) {
		return JSON.stringify(input).replace(regexForJSStringsInScripts, function(match) {
			switch (match) {
				case "&": return "\\u0026";
				case ">": return "\\u003e";
				case "<": return "\\u003c";
				case "\u2028": return "\\u2028";
				case "\u2029": return "\\u2029";
				default: throw Error("escapeJSObjectForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React");
			}
		});
	}
	var currentlyRenderingBoundaryHasStylesToHoist = !1;
	var destinationHasCapacity = !0;
	function flushStyleTagsLateForBoundary(styleQueue) {
		var rules = styleQueue.rules, hrefs = styleQueue.hrefs, i = 0;
		if (hrefs.length) {
			this.push(currentlyFlushingRenderState.startInlineStyle);
			this.push(" media=\"not all\" data-precedence=\"");
			this.push(styleQueue.precedence);
			for (this.push("\" data-href=\""); i < hrefs.length - 1; i++) this.push(hrefs[i]), this.push(" ");
			this.push(hrefs[i]);
			this.push("\">");
			for (i = 0; i < rules.length; i++) this.push(rules[i]);
			destinationHasCapacity = this.push("</style>");
			currentlyRenderingBoundaryHasStylesToHoist = !0;
			rules.length = 0;
			hrefs.length = 0;
		}
	}
	function hasStylesToHoist(stylesheet) {
		return 2 !== stylesheet.state ? currentlyRenderingBoundaryHasStylesToHoist = !0 : !1;
	}
	function writeHoistablesForBoundary(destination, hoistableState, renderState) {
		currentlyRenderingBoundaryHasStylesToHoist = !1;
		destinationHasCapacity = !0;
		currentlyFlushingRenderState = renderState;
		hoistableState.styles.forEach(flushStyleTagsLateForBoundary, destination);
		currentlyFlushingRenderState = null;
		hoistableState.stylesheets.forEach(hasStylesToHoist);
		currentlyRenderingBoundaryHasStylesToHoist && (renderState.stylesToHoist = !0);
		return destinationHasCapacity;
	}
	function flushResource(resource) {
		for (var i = 0; i < resource.length; i++) this.push(resource[i]);
		resource.length = 0;
	}
	var stylesheetFlushingQueue = [];
	function flushStyleInPreamble(stylesheet) {
		pushLinkImpl(stylesheetFlushingQueue, stylesheet.props);
		for (var i = 0; i < stylesheetFlushingQueue.length; i++) this.push(stylesheetFlushingQueue[i]);
		stylesheetFlushingQueue.length = 0;
		stylesheet.state = 2;
	}
	function flushStylesInPreamble(styleQueue) {
		var hasStylesheets = 0 < styleQueue.sheets.size;
		styleQueue.sheets.forEach(flushStyleInPreamble, this);
		styleQueue.sheets.clear();
		var rules = styleQueue.rules, hrefs = styleQueue.hrefs;
		if (!hasStylesheets || hrefs.length) {
			this.push(currentlyFlushingRenderState.startInlineStyle);
			this.push(" data-precedence=\"");
			this.push(styleQueue.precedence);
			styleQueue = 0;
			if (hrefs.length) {
				for (this.push("\" data-href=\""); styleQueue < hrefs.length - 1; styleQueue++) this.push(hrefs[styleQueue]), this.push(" ");
				this.push(hrefs[styleQueue]);
			}
			this.push("\">");
			for (styleQueue = 0; styleQueue < rules.length; styleQueue++) this.push(rules[styleQueue]);
			this.push("</style>");
			rules.length = 0;
			hrefs.length = 0;
		}
	}
	function preloadLateStyle(stylesheet) {
		if (0 === stylesheet.state) {
			stylesheet.state = 1;
			var props = stylesheet.props;
			pushLinkImpl(stylesheetFlushingQueue, {
				rel: "preload",
				as: "style",
				href: stylesheet.props.href,
				crossOrigin: props.crossOrigin,
				fetchPriority: props.fetchPriority,
				integrity: props.integrity,
				media: props.media,
				hrefLang: props.hrefLang,
				referrerPolicy: props.referrerPolicy
			});
			for (stylesheet = 0; stylesheet < stylesheetFlushingQueue.length; stylesheet++) this.push(stylesheetFlushingQueue[stylesheet]);
			stylesheetFlushingQueue.length = 0;
		}
	}
	function preloadLateStyles(styleQueue) {
		styleQueue.sheets.forEach(preloadLateStyle, this);
		styleQueue.sheets.clear();
	}
	function pushCompletedShellIdAttribute(target, resumableState) {
		0 === (resumableState.instructions & 32) && (resumableState.instructions |= 32, target.push(" id=\"", escapeTextForBrowser("_" + resumableState.idPrefix + "R_"), "\""));
	}
	function writeStyleResourceDependenciesInJS(destination, hoistableState) {
		destination.push("[");
		var nextArrayOpenBrackChunk = "[";
		hoistableState.stylesheets.forEach(function(resource) {
			if (2 !== resource.state) if (3 === resource.state) destination.push(nextArrayOpenBrackChunk), resource = escapeJSObjectForInstructionScripts("" + resource.props.href), destination.push(resource), destination.push("]"), nextArrayOpenBrackChunk = ",[";
			else {
				destination.push(nextArrayOpenBrackChunk);
				var precedence = resource.props["data-precedence"], props = resource.props, coercedHref = sanitizeURL("" + resource.props.href);
				coercedHref = escapeJSObjectForInstructionScripts(coercedHref);
				destination.push(coercedHref);
				precedence = "" + precedence;
				destination.push(",");
				precedence = escapeJSObjectForInstructionScripts(precedence);
				destination.push(precedence);
				for (var propKey in props) if (hasOwnProperty.call(props, propKey) && (precedence = props[propKey], null != precedence)) switch (propKey) {
					case "href":
					case "rel":
					case "precedence":
					case "data-precedence": break;
					case "children":
					case "dangerouslySetInnerHTML": throw Error("link is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.");
					default: writeStyleResourceAttributeInJS(destination, propKey, precedence);
				}
				destination.push("]");
				nextArrayOpenBrackChunk = ",[";
				resource.state = 3;
			}
		});
		destination.push("]");
	}
	function writeStyleResourceAttributeInJS(destination, name, value) {
		var attributeName = name.toLowerCase();
		switch (typeof value) {
			case "function":
			case "symbol": return;
		}
		switch (name) {
			case "innerHTML":
			case "dangerouslySetInnerHTML":
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "style":
			case "ref": return;
			case "className":
				attributeName = "class";
				name = "" + value;
				break;
			case "hidden":
				if (!1 === value) return;
				name = "";
				break;
			case "src":
			case "href":
				value = sanitizeURL(value);
				name = "" + value;
				break;
			default:
				if (2 < name.length && ("o" === name[0] || "O" === name[0]) && ("n" === name[1] || "N" === name[1]) || !isAttributeNameSafe(name)) return;
				name = "" + value;
		}
		destination.push(",");
		attributeName = escapeJSObjectForInstructionScripts(attributeName);
		destination.push(attributeName);
		destination.push(",");
		attributeName = escapeJSObjectForInstructionScripts(name);
		destination.push(attributeName);
	}
	function createHoistableState() {
		return {
			styles: /* @__PURE__ */ new Set(),
			stylesheets: /* @__PURE__ */ new Set(),
			suspenseyImages: !1
		};
	}
	function prefetchDNS(href) {
		var request = currentRequest ? currentRequest : null;
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if ("string" === typeof href && href) {
				if (!resumableState.dnsResources.hasOwnProperty(href)) {
					resumableState.dnsResources[href] = null;
					resumableState = renderState.headers;
					var header, JSCompiler_temp;
					if (JSCompiler_temp = resumableState && 0 < resumableState.remainingCapacity) JSCompiler_temp = (header = "<" + ("" + href).replace(regexForHrefInLinkHeaderURLContext, escapeHrefForLinkHeaderURLContextReplacer) + ">; rel=dns-prefetch", 0 <= (resumableState.remainingCapacity -= header.length + 2));
					JSCompiler_temp ? (renderState.resets.dns[href] = null, resumableState.preconnects && (resumableState.preconnects += ", "), resumableState.preconnects += header) : (header = [], pushLinkImpl(header, {
						href,
						rel: "dns-prefetch"
					}), renderState.preconnects.add(header));
				}
				enqueueFlush(request);
			}
		} else previousDispatcher.D(href);
	}
	function preconnect(href, crossOrigin) {
		var request = currentRequest ? currentRequest : null;
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if ("string" === typeof href && href) {
				var bucket = "use-credentials" === crossOrigin ? "credentials" : "string" === typeof crossOrigin ? "anonymous" : "default";
				if (!resumableState.connectResources[bucket].hasOwnProperty(href)) {
					resumableState.connectResources[bucket][href] = null;
					resumableState = renderState.headers;
					var header, JSCompiler_temp;
					if (JSCompiler_temp = resumableState && 0 < resumableState.remainingCapacity) {
						JSCompiler_temp = "<" + ("" + href).replace(regexForHrefInLinkHeaderURLContext, escapeHrefForLinkHeaderURLContextReplacer) + ">; rel=preconnect";
						if ("string" === typeof crossOrigin) {
							var escapedCrossOrigin = ("" + crossOrigin).replace(regexForLinkHeaderQuotedParamValueContext, escapeStringForLinkHeaderQuotedParamValueContextReplacer);
							JSCompiler_temp += "; crossorigin=\"" + escapedCrossOrigin + "\"";
						}
						JSCompiler_temp = (header = JSCompiler_temp, 0 <= (resumableState.remainingCapacity -= header.length + 2));
					}
					JSCompiler_temp ? (renderState.resets.connect[bucket][href] = null, resumableState.preconnects && (resumableState.preconnects += ", "), resumableState.preconnects += header) : (bucket = [], pushLinkImpl(bucket, {
						rel: "preconnect",
						href,
						crossOrigin
					}), renderState.preconnects.add(bucket));
				}
				enqueueFlush(request);
			}
		} else previousDispatcher.C(href, crossOrigin);
	}
	function preload(href, as, options) {
		var request = currentRequest ? currentRequest : null;
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if (as && href) {
				switch (as) {
					case "image":
						if (options) {
							var imageSrcSet = options.imageSrcSet;
							var imageSizes = options.imageSizes;
							var fetchPriority = options.fetchPriority;
						}
						var key = imageSrcSet ? imageSrcSet + "\n" + (imageSizes || "") : href;
						if (resumableState.imageResources.hasOwnProperty(key)) return;
						resumableState.imageResources[key] = PRELOAD_NO_CREDS;
						resumableState = renderState.headers;
						var header;
						resumableState && 0 < resumableState.remainingCapacity && "string" !== typeof imageSrcSet && "high" === fetchPriority && (header = getPreloadAsHeader(href, as, options), 0 <= (resumableState.remainingCapacity -= header.length + 2)) ? (renderState.resets.image[key] = PRELOAD_NO_CREDS, resumableState.highImagePreloads && (resumableState.highImagePreloads += ", "), resumableState.highImagePreloads += header) : (resumableState = [], pushLinkImpl(resumableState, assign({
							rel: "preload",
							href: imageSrcSet ? void 0 : href,
							as
						}, options)), "high" === fetchPriority ? renderState.highImagePreloads.add(resumableState) : (renderState.bulkPreloads.add(resumableState), renderState.preloads.images.set(key, resumableState)));
						break;
					case "style":
						if (resumableState.styleResources.hasOwnProperty(href)) return;
						imageSrcSet = [];
						pushLinkImpl(imageSrcSet, assign({
							rel: "preload",
							href,
							as
						}, options));
						resumableState.styleResources[href] = !options || "string" !== typeof options.crossOrigin && "string" !== typeof options.integrity ? PRELOAD_NO_CREDS : [options.crossOrigin, options.integrity];
						renderState.preloads.stylesheets.set(href, imageSrcSet);
						renderState.bulkPreloads.add(imageSrcSet);
						break;
					case "script":
						if (resumableState.scriptResources.hasOwnProperty(href)) return;
						imageSrcSet = [];
						renderState.preloads.scripts.set(href, imageSrcSet);
						renderState.bulkPreloads.add(imageSrcSet);
						pushLinkImpl(imageSrcSet, assign({
							rel: "preload",
							href,
							as
						}, options));
						resumableState.scriptResources[href] = !options || "string" !== typeof options.crossOrigin && "string" !== typeof options.integrity ? PRELOAD_NO_CREDS : [options.crossOrigin, options.integrity];
						break;
					default:
						if (resumableState.unknownResources.hasOwnProperty(as)) {
							if (imageSrcSet = resumableState.unknownResources[as], imageSrcSet.hasOwnProperty(href)) return;
						} else imageSrcSet = {}, resumableState.unknownResources[as] = imageSrcSet;
						imageSrcSet[href] = PRELOAD_NO_CREDS;
						if ((resumableState = renderState.headers) && 0 < resumableState.remainingCapacity && "font" === as && (key = getPreloadAsHeader(href, as, options), 0 <= (resumableState.remainingCapacity -= key.length + 2))) renderState.resets.font[href] = PRELOAD_NO_CREDS, resumableState.fontPreloads && (resumableState.fontPreloads += ", "), resumableState.fontPreloads += key;
						else switch (resumableState = [], href = assign({
							rel: "preload",
							href,
							as
						}, options), pushLinkImpl(resumableState, href), as) {
							case "font":
								renderState.fontPreloads.add(resumableState);
								break;
							default: renderState.bulkPreloads.add(resumableState);
						}
				}
				enqueueFlush(request);
			}
		} else previousDispatcher.L(href, as, options);
	}
	function preloadModule(href, options) {
		var request = currentRequest ? currentRequest : null;
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if (href) {
				var as = options && "string" === typeof options.as ? options.as : "script";
				switch (as) {
					case "script":
						if (resumableState.moduleScriptResources.hasOwnProperty(href)) return;
						as = [];
						resumableState.moduleScriptResources[href] = !options || "string" !== typeof options.crossOrigin && "string" !== typeof options.integrity ? PRELOAD_NO_CREDS : [options.crossOrigin, options.integrity];
						renderState.preloads.moduleScripts.set(href, as);
						break;
					default:
						if (resumableState.moduleUnknownResources.hasOwnProperty(as)) {
							var resources = resumableState.moduleUnknownResources[as];
							if (resources.hasOwnProperty(href)) return;
						} else resources = {}, resumableState.moduleUnknownResources[as] = resources;
						as = [];
						resources[href] = PRELOAD_NO_CREDS;
				}
				pushLinkImpl(as, assign({
					rel: "modulepreload",
					href
				}, options));
				renderState.bulkPreloads.add(as);
				enqueueFlush(request);
			}
		} else previousDispatcher.m(href, options);
	}
	function preinitStyle(href, precedence, options) {
		var request = currentRequest ? currentRequest : null;
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if (href) {
				precedence = precedence || "default";
				var styleQueue = renderState.styles.get(precedence), resourceState = resumableState.styleResources.hasOwnProperty(href) ? resumableState.styleResources[href] : void 0;
				null !== resourceState && (resumableState.styleResources[href] = null, styleQueue || (styleQueue = {
					precedence: escapeTextForBrowser(precedence),
					rules: [],
					hrefs: [],
					sheets: /* @__PURE__ */ new Map()
				}, renderState.styles.set(precedence, styleQueue)), precedence = {
					state: 0,
					props: assign({
						rel: "stylesheet",
						href,
						"data-precedence": precedence
					}, options)
				}, resourceState && (2 === resourceState.length && adoptPreloadCredentials(precedence.props, resourceState), (renderState = renderState.preloads.stylesheets.get(href)) && 0 < renderState.length ? renderState.length = 0 : precedence.state = 1), styleQueue.sheets.set(href, precedence), enqueueFlush(request));
			}
		} else previousDispatcher.S(href, precedence, options);
	}
	function preinitScript(src, options) {
		var request = currentRequest ? currentRequest : null;
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if (src) {
				var resourceState = resumableState.scriptResources.hasOwnProperty(src) ? resumableState.scriptResources[src] : void 0;
				null !== resourceState && (resumableState.scriptResources[src] = null, options = assign({
					src,
					async: !0
				}, options), resourceState && (2 === resourceState.length && adoptPreloadCredentials(options, resourceState), src = renderState.preloads.scripts.get(src)) && (src.length = 0), src = [], renderState.scripts.add(src), pushScriptImpl(src, options), enqueueFlush(request));
			}
		} else previousDispatcher.X(src, options);
	}
	function preinitModuleScript(src, options) {
		var request = currentRequest ? currentRequest : null;
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if (src) {
				var resourceState = resumableState.moduleScriptResources.hasOwnProperty(src) ? resumableState.moduleScriptResources[src] : void 0;
				null !== resourceState && (resumableState.moduleScriptResources[src] = null, options = assign({
					src,
					type: "module",
					async: !0
				}, options), resourceState && (2 === resourceState.length && adoptPreloadCredentials(options, resourceState), src = renderState.preloads.moduleScripts.get(src)) && (src.length = 0), src = [], renderState.scripts.add(src), pushScriptImpl(src, options), enqueueFlush(request));
			}
		} else previousDispatcher.M(src, options);
	}
	function adoptPreloadCredentials(target, preloadState) {
		target.crossOrigin ??= preloadState[0];
		target.integrity ??= preloadState[1];
	}
	function getPreloadAsHeader(href, as, params) {
		href = ("" + href).replace(regexForHrefInLinkHeaderURLContext, escapeHrefForLinkHeaderURLContextReplacer);
		as = ("" + as).replace(regexForLinkHeaderQuotedParamValueContext, escapeStringForLinkHeaderQuotedParamValueContextReplacer);
		as = "<" + href + ">; rel=preload; as=\"" + as + "\"";
		for (var paramName in params) hasOwnProperty.call(params, paramName) && (href = params[paramName], "string" === typeof href && (as += "; " + paramName.toLowerCase() + "=\"" + ("" + href).replace(regexForLinkHeaderQuotedParamValueContext, escapeStringForLinkHeaderQuotedParamValueContextReplacer) + "\""));
		return as;
	}
	var regexForHrefInLinkHeaderURLContext = /[<>\r\n]/g;
	function escapeHrefForLinkHeaderURLContextReplacer(match) {
		switch (match) {
			case "<": return "%3C";
			case ">": return "%3E";
			case "\n": return "%0A";
			case "\r": return "%0D";
			default: throw Error("escapeLinkHrefForHeaderContextReplacer encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React");
		}
	}
	var regexForLinkHeaderQuotedParamValueContext = /["';,\r\n]/g;
	function escapeStringForLinkHeaderQuotedParamValueContextReplacer(match) {
		switch (match) {
			case "\"": return "%22";
			case "'": return "%27";
			case ";": return "%3B";
			case ",": return "%2C";
			case "\n": return "%0A";
			case "\r": return "%0D";
			default: throw Error("escapeStringForLinkHeaderQuotedParamValueContextReplacer encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React");
		}
	}
	function hoistStyleQueueDependency(styleQueue) {
		this.styles.add(styleQueue);
	}
	function hoistStylesheetDependency(stylesheet) {
		this.stylesheets.add(stylesheet);
	}
	function hoistHoistables(parentState, childState) {
		childState.styles.forEach(hoistStyleQueueDependency, parentState);
		childState.stylesheets.forEach(hoistStylesheetDependency, parentState);
		childState.suspenseyImages && (parentState.suspenseyImages = !0);
	}
	function createRenderState(resumableState, generateStaticMarkup) {
		var idPrefix = resumableState.idPrefix, bootstrapChunks = [], bootstrapScriptContent = resumableState.bootstrapScriptContent, bootstrapScripts = resumableState.bootstrapScripts, bootstrapModules = resumableState.bootstrapModules;
		void 0 !== bootstrapScriptContent && (bootstrapChunks.push("<script"), pushCompletedShellIdAttribute(bootstrapChunks, resumableState), bootstrapChunks.push(">", ("" + bootstrapScriptContent).replace(scriptRegex, scriptReplacer), "<\/script>"));
		bootstrapScriptContent = idPrefix + "P:";
		var JSCompiler_object_inline_segmentPrefix_1724 = idPrefix + "S:";
		idPrefix += "B:";
		var JSCompiler_object_inline_preconnects_1738 = /* @__PURE__ */ new Set(), JSCompiler_object_inline_fontPreloads_1739 = /* @__PURE__ */ new Set(), JSCompiler_object_inline_highImagePreloads_1740 = /* @__PURE__ */ new Set(), JSCompiler_object_inline_styles_1741 = /* @__PURE__ */ new Map(), JSCompiler_object_inline_bootstrapScripts_1742 = /* @__PURE__ */ new Set(), JSCompiler_object_inline_scripts_1743 = /* @__PURE__ */ new Set(), JSCompiler_object_inline_bulkPreloads_1744 = /* @__PURE__ */ new Set(), JSCompiler_object_inline_preloads_1745 = {
			images: /* @__PURE__ */ new Map(),
			stylesheets: /* @__PURE__ */ new Map(),
			scripts: /* @__PURE__ */ new Map(),
			moduleScripts: /* @__PURE__ */ new Map()
		};
		if (void 0 !== bootstrapScripts) for (var i = 0; i < bootstrapScripts.length; i++) {
			var scriptConfig = bootstrapScripts[i], src, crossOrigin = void 0, integrity = void 0, props = {
				rel: "preload",
				as: "script",
				fetchPriority: "low",
				nonce: void 0
			};
			"string" === typeof scriptConfig ? props.href = src = scriptConfig : (props.href = src = scriptConfig.src, props.integrity = integrity = "string" === typeof scriptConfig.integrity ? scriptConfig.integrity : void 0, props.crossOrigin = crossOrigin = "string" === typeof scriptConfig || null == scriptConfig.crossOrigin ? void 0 : "use-credentials" === scriptConfig.crossOrigin ? "use-credentials" : "");
			scriptConfig = resumableState;
			var href = src;
			scriptConfig.scriptResources[href] = null;
			scriptConfig.moduleScriptResources[href] = null;
			scriptConfig = [];
			pushLinkImpl(scriptConfig, props);
			JSCompiler_object_inline_bootstrapScripts_1742.add(scriptConfig);
			bootstrapChunks.push("<script src=\"", escapeTextForBrowser(src), "\"");
			"string" === typeof integrity && bootstrapChunks.push(" integrity=\"", escapeTextForBrowser(integrity), "\"");
			"string" === typeof crossOrigin && bootstrapChunks.push(" crossorigin=\"", escapeTextForBrowser(crossOrigin), "\"");
			pushCompletedShellIdAttribute(bootstrapChunks, resumableState);
			bootstrapChunks.push(" async=\"\"><\/script>");
		}
		if (void 0 !== bootstrapModules) for (bootstrapScripts = 0; bootstrapScripts < bootstrapModules.length; bootstrapScripts++) props = bootstrapModules[bootstrapScripts], crossOrigin = src = void 0, integrity = {
			rel: "modulepreload",
			fetchPriority: "low",
			nonce: void 0
		}, "string" === typeof props ? integrity.href = i = props : (integrity.href = i = props.src, integrity.integrity = crossOrigin = "string" === typeof props.integrity ? props.integrity : void 0, integrity.crossOrigin = src = "string" === typeof props || null == props.crossOrigin ? void 0 : "use-credentials" === props.crossOrigin ? "use-credentials" : ""), props = resumableState, scriptConfig = i, props.scriptResources[scriptConfig] = null, props.moduleScriptResources[scriptConfig] = null, props = [], pushLinkImpl(props, integrity), JSCompiler_object_inline_bootstrapScripts_1742.add(props), bootstrapChunks.push("<script type=\"module\" src=\"", escapeTextForBrowser(i), "\""), "string" === typeof crossOrigin && bootstrapChunks.push(" integrity=\"", escapeTextForBrowser(crossOrigin), "\""), "string" === typeof src && bootstrapChunks.push(" crossorigin=\"", escapeTextForBrowser(src), "\""), pushCompletedShellIdAttribute(bootstrapChunks, resumableState), bootstrapChunks.push(" async=\"\"><\/script>");
		return {
			placeholderPrefix: bootstrapScriptContent,
			segmentPrefix: JSCompiler_object_inline_segmentPrefix_1724,
			boundaryPrefix: idPrefix,
			startInlineScript: "<script",
			startInlineStyle: "<style",
			preamble: {
				htmlChunks: null,
				headChunks: null,
				bodyChunks: null
			},
			externalRuntimeScript: null,
			bootstrapChunks,
			importMapChunks: [],
			onHeaders: void 0,
			headers: null,
			resets: {
				font: {},
				dns: {},
				connect: {
					default: {},
					anonymous: {},
					credentials: {}
				},
				image: {},
				style: {}
			},
			charsetChunks: [],
			viewportChunks: [],
			hoistableChunks: [],
			preconnects: JSCompiler_object_inline_preconnects_1738,
			fontPreloads: JSCompiler_object_inline_fontPreloads_1739,
			highImagePreloads: JSCompiler_object_inline_highImagePreloads_1740,
			styles: JSCompiler_object_inline_styles_1741,
			bootstrapScripts: JSCompiler_object_inline_bootstrapScripts_1742,
			scripts: JSCompiler_object_inline_scripts_1743,
			bulkPreloads: JSCompiler_object_inline_bulkPreloads_1744,
			preloads: JSCompiler_object_inline_preloads_1745,
			nonce: {
				script: void 0,
				style: void 0
			},
			stylesToHoist: !1,
			generateStaticMarkup
		};
	}
	function pushTextInstance(target, text, renderState, textEmbedded) {
		if (renderState.generateStaticMarkup) return target.push(escapeTextForBrowser(text)), !1;
		"" === text ? target = textEmbedded : (textEmbedded && target.push("<!-- -->"), target.push(escapeTextForBrowser(text)), target = !0);
		return target;
	}
	function pushSegmentFinale(target, renderState, lastPushedText, textEmbedded) {
		renderState.generateStaticMarkup || lastPushedText && textEmbedded && target.push("<!-- -->");
	}
	var bind = Function.prototype.bind;
	var REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference");
	function getComponentNameFromType(type) {
		if (null == type) return null;
		if ("function" === typeof type) return type.$$typeof === REACT_CLIENT_REFERENCE ? null : type.displayName || type.name || null;
		if ("string" === typeof type) return type;
		switch (type) {
			case REACT_FRAGMENT_TYPE: return "Fragment";
			case REACT_PROFILER_TYPE: return "Profiler";
			case REACT_STRICT_MODE_TYPE: return "StrictMode";
			case REACT_SUSPENSE_TYPE: return "Suspense";
			case REACT_SUSPENSE_LIST_TYPE: return "SuspenseList";
			case REACT_ACTIVITY_TYPE: return "Activity";
			case REACT_VIEW_TRANSITION_TYPE: return "ViewTransition";
		}
		if ("object" === typeof type) switch (type.$$typeof) {
			case REACT_PORTAL_TYPE: return "Portal";
			case REACT_CONTEXT_TYPE: return type.displayName || "Context";
			case REACT_CONSUMER_TYPE: return (type._context.displayName || "Context") + ".Consumer";
			case REACT_FORWARD_REF_TYPE:
				var innerType = type.render;
				type = type.displayName;
				type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
				return type;
			case REACT_MEMO_TYPE: return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
			case REACT_LAZY_TYPE:
				innerType = type._payload;
				type = type._init;
				try {
					return getComponentNameFromType(type(innerType));
				} catch (x) {}
		}
		return null;
	}
	var emptyContextObject = {};
	var currentActiveSnapshot = null;
	function popToNearestCommonAncestor(prev, next) {
		if (prev !== next) {
			prev.context._currentValue2 = prev.parentValue;
			prev = prev.parent;
			var parentNext = next.parent;
			if (null === prev) {
				if (null !== parentNext) throw Error("The stacks must reach the root at the same time. This is a bug in React.");
			} else {
				if (null === parentNext) throw Error("The stacks must reach the root at the same time. This is a bug in React.");
				popToNearestCommonAncestor(prev, parentNext);
			}
			next.context._currentValue2 = next.value;
		}
	}
	function popAllPrevious(prev) {
		prev.context._currentValue2 = prev.parentValue;
		prev = prev.parent;
		null !== prev && popAllPrevious(prev);
	}
	function pushAllNext(next) {
		var parentNext = next.parent;
		null !== parentNext && pushAllNext(parentNext);
		next.context._currentValue2 = next.value;
	}
	function popPreviousToCommonLevel(prev, next) {
		prev.context._currentValue2 = prev.parentValue;
		prev = prev.parent;
		if (null === prev) throw Error("The depth must equal at least at zero before reaching the root. This is a bug in React.");
		prev.depth === next.depth ? popToNearestCommonAncestor(prev, next) : popPreviousToCommonLevel(prev, next);
	}
	function popNextToCommonLevel(prev, next) {
		var parentNext = next.parent;
		if (null === parentNext) throw Error("The depth must equal at least at zero before reaching the root. This is a bug in React.");
		prev.depth === parentNext.depth ? popToNearestCommonAncestor(prev, parentNext) : popNextToCommonLevel(prev, parentNext);
		next.context._currentValue2 = next.value;
	}
	function switchContext(newSnapshot) {
		var prev = currentActiveSnapshot;
		prev !== newSnapshot && (null === prev ? pushAllNext(newSnapshot) : null === newSnapshot ? popAllPrevious(prev) : prev.depth === newSnapshot.depth ? popToNearestCommonAncestor(prev, newSnapshot) : prev.depth > newSnapshot.depth ? popPreviousToCommonLevel(prev, newSnapshot) : popNextToCommonLevel(prev, newSnapshot), currentActiveSnapshot = newSnapshot);
	}
	var classComponentUpdater = {
		enqueueSetState: function(inst, payload) {
			inst = inst._reactInternals;
			null !== inst.queue && inst.queue.push(payload);
		},
		enqueueReplaceState: function(inst, payload) {
			inst = inst._reactInternals;
			inst.replace = !0;
			inst.queue = [payload];
		},
		enqueueForceUpdate: function() {}
	};
	var emptyTreeContext = {
		id: 1,
		overflow: ""
	};
	function getTreeId(context) {
		var overflow = context.overflow;
		context = context.id;
		return (context & ~(1 << 32 - clz32(context) - 1)).toString(32) + overflow;
	}
	function pushTreeContext(baseContext, totalChildren, index) {
		var baseIdWithLeadingBit = baseContext.id;
		baseContext = baseContext.overflow;
		var baseLength = 32 - clz32(baseIdWithLeadingBit) - 1;
		baseIdWithLeadingBit &= ~(1 << baseLength);
		index += 1;
		var length = 32 - clz32(totalChildren) + baseLength;
		if (30 < length) {
			var numberOfOverflowBits = baseLength - baseLength % 5;
			length = (baseIdWithLeadingBit & (1 << numberOfOverflowBits) - 1).toString(32);
			baseIdWithLeadingBit >>= numberOfOverflowBits;
			baseLength -= numberOfOverflowBits;
			return {
				id: 1 << 32 - clz32(totalChildren) + baseLength | index << baseLength | baseIdWithLeadingBit,
				overflow: length + baseContext
			};
		}
		return {
			id: 1 << length | index << baseLength | baseIdWithLeadingBit,
			overflow: baseContext
		};
	}
	var clz32 = Math.clz32 ? Math.clz32 : clz32Fallback;
	var log = Math.log;
	var LN2 = Math.LN2;
	function clz32Fallback(x) {
		x >>>= 0;
		return 0 === x ? 32 : 31 - (log(x) / LN2 | 0) | 0;
	}
	function noop() {}
	var SuspenseException = Error("Suspense Exception: This is not a real error! It's an implementation detail of `use` to interrupt the current render. You must either rethrow it immediately, or move the `use` call outside of the `try/catch` block. Capturing without rethrowing will lead to unexpected behavior.\n\nTo handle async errors, wrap your component in an error boundary, or call the promise's `.catch` method and pass the result to `use`.");
	function trackUsedThenable(thenableState, thenable, index) {
		index = thenableState[index];
		void 0 === index ? thenableState.push(thenable) : index !== thenable && (thenable.then(noop, noop), thenable = index);
		switch (thenable.status) {
			case "fulfilled": return thenable.value;
			case "rejected":
				thenableState = thenable.reason;
				if (void 0 === thenableState && !("reason" in thenable)) throw Error("A rejected Promise was passed to React without a `reason` property. React threw a generic error from where the Promise was used to assist in identifying the problematic Promise. Make sure that instrumented Promises correctly set the `reason` property when setting `status` to `'rejected'`.");
				throw thenableState;
			default:
				"string" === typeof thenable.status ? thenable.then(noop, noop) : (thenableState = thenable, thenableState.status = "pending", thenableState.then(function(fulfilledValue) {
					if ("pending" === thenable.status) {
						var fulfilledThenable = thenable;
						fulfilledThenable.status = "fulfilled";
						fulfilledThenable.value = fulfilledValue;
					}
				}, function(error) {
					if ("pending" === thenable.status) {
						var rejectedThenable = thenable;
						rejectedThenable.status = "rejected";
						rejectedThenable.reason = error;
					}
				}));
				switch (thenable.status) {
					case "fulfilled": return thenable.value;
					case "rejected": throw thenable.reason;
				}
				suspendedThenable = thenable;
				throw SuspenseException;
		}
	}
	var suspendedThenable = null;
	function getSuspendedThenable() {
		if (null === suspendedThenable) throw Error("Expected a suspended thenable. This is a bug in React. Please file an issue.");
		var thenable = suspendedThenable;
		suspendedThenable = null;
		return thenable;
	}
	function is(x, y) {
		return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
	}
	var objectIs = "function" === typeof Object.is ? Object.is : is;
	var currentlyRenderingComponent = null;
	var currentlyRenderingTask = null;
	var currentlyRenderingRequest = null;
	var currentlyRenderingKeyPath = null;
	var firstWorkInProgressHook = null;
	var workInProgressHook = null;
	var isReRender = !1;
	var didScheduleRenderPhaseUpdate = !1;
	var localIdCounter = 0;
	var actionStateCounter = 0;
	var actionStateMatchingIndex = -1;
	var thenableIndexCounter = 0;
	var thenableState = null;
	function createRecoverableError(recoverable) {
		recoverable = recoverable._reason;
		if ("function" === typeof recoverable) try {
			var initializedReason = recoverable();
		} catch ($jscomp$unused$catch) {
			initializedReason = "The reason for browser-only rendering could not be determined because its initializer threw.";
		}
		else initializedReason = recoverable;
		initializedReason = Error("Browser-only rendering was requested by `browser()`.", void 0 === recoverable ? void 0 : { cause: initializedReason });
		Object.defineProperty(initializedReason, REACT_RECOVERABLE_TYPE, { value: !0 });
		return initializedReason;
	}
	function isRecoverableError(error) {
		return "object" !== typeof error || null === error ? !1 : !0 === error[REACT_RECOVERABLE_TYPE];
	}
	function cloneRecoverableErrorAsFatal(recoverableError) {
		var fatalRecoverableError = Error("The server render could not complete because client rendering was requested outside a Suspense boundary. See this error's cause for additional details.", hasOwnProperty.call(recoverableError, "cause") ? { cause: recoverableError.cause } : void 0);
		recoverableError = recoverableError.stack;
		if (void 0 !== recoverableError) {
			var frameStart = recoverableError.indexOf("\n");
			fatalRecoverableError.stack = fatalRecoverableError.name + ": " + fatalRecoverableError.message + (-1 === frameStart ? "" : recoverableError.slice(frameStart));
		} else fatalRecoverableError.stack = void 0;
		return fatalRecoverableError;
	}
	var renderPhaseUpdates = null;
	var numberOfReRenders = 0;
	function resolveCurrentlyRenderingComponent() {
		if (null === currentlyRenderingComponent) throw Error("Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.");
		return currentlyRenderingComponent;
	}
	function createHook() {
		if (0 < numberOfReRenders) throw Error("Rendered more hooks than during the previous render");
		return {
			memoizedState: null,
			queue: null,
			next: null
		};
	}
	function createWorkInProgressHook() {
		null === workInProgressHook ? null === firstWorkInProgressHook ? (isReRender = !1, firstWorkInProgressHook = workInProgressHook = createHook()) : (isReRender = !0, workInProgressHook = firstWorkInProgressHook) : null === workInProgressHook.next ? (isReRender = !1, workInProgressHook = workInProgressHook.next = createHook()) : (isReRender = !0, workInProgressHook = workInProgressHook.next);
		return workInProgressHook;
	}
	function getThenableStateAfterSuspending() {
		var state = thenableState;
		thenableState = null;
		return state;
	}
	function resetHooksState() {
		currentlyRenderingKeyPath = currentlyRenderingRequest = currentlyRenderingTask = currentlyRenderingComponent = null;
		didScheduleRenderPhaseUpdate = !1;
		firstWorkInProgressHook = null;
		numberOfReRenders = 0;
		workInProgressHook = renderPhaseUpdates = null;
	}
	function basicStateReducer(state, action) {
		return "function" === typeof action ? action(state) : action;
	}
	function useReducer(reducer, initialArg, init) {
		currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
		workInProgressHook = createWorkInProgressHook();
		if (isReRender) {
			var queue = workInProgressHook.queue;
			initialArg = queue.dispatch;
			if (null !== renderPhaseUpdates && (init = renderPhaseUpdates.get(queue), void 0 !== init)) {
				renderPhaseUpdates.delete(queue);
				queue = workInProgressHook.memoizedState;
				do
					queue = reducer(queue, init.action), init = init.next;
				while (null !== init);
				workInProgressHook.memoizedState = queue;
				return [queue, initialArg];
			}
			return [workInProgressHook.memoizedState, initialArg];
		}
		reducer = reducer === basicStateReducer ? "function" === typeof initialArg ? initialArg() : initialArg : void 0 !== init ? init(initialArg) : initialArg;
		workInProgressHook.memoizedState = reducer;
		reducer = workInProgressHook.queue = {
			last: null,
			dispatch: null
		};
		reducer = reducer.dispatch = dispatchAction.bind(null, currentlyRenderingComponent, reducer);
		return [workInProgressHook.memoizedState, reducer];
	}
	function useMemo(nextCreate, deps) {
		currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
		workInProgressHook = createWorkInProgressHook();
		deps = void 0 === deps ? null : deps;
		if (null !== workInProgressHook) {
			var prevState = workInProgressHook.memoizedState;
			if (null !== prevState && null !== deps) {
				var prevDeps = prevState[1];
				a: if (null === prevDeps) prevDeps = !1;
				else {
					for (var i = 0; i < prevDeps.length && i < deps.length; i++) if (!objectIs(deps[i], prevDeps[i])) {
						prevDeps = !1;
						break a;
					}
					prevDeps = !0;
				}
				if (prevDeps) return prevState[0];
			}
		}
		nextCreate = nextCreate();
		workInProgressHook.memoizedState = [nextCreate, deps];
		return nextCreate;
	}
	function dispatchAction(componentIdentity, queue, action) {
		if (25 <= numberOfReRenders) throw Error("Too many re-renders. React limits the number of renders to prevent an infinite loop.");
		if (componentIdentity === currentlyRenderingComponent) if (didScheduleRenderPhaseUpdate = !0, componentIdentity = {
			action,
			next: null
		}, null === renderPhaseUpdates && (renderPhaseUpdates = /* @__PURE__ */ new Map()), action = renderPhaseUpdates.get(queue), void 0 === action) renderPhaseUpdates.set(queue, componentIdentity);
		else {
			for (queue = action; null !== queue.next;) queue = queue.next;
			queue.next = componentIdentity;
		}
	}
	function throwOnUseEffectEventCall() {
		throw Error("A function wrapped in useEffectEvent can't be called during rendering.");
	}
	function unsupportedStartTransition() {
		throw Error("startTransition cannot be called during server rendering.");
	}
	function unsupportedSetOptimisticState() {
		throw Error("Cannot update optimistic state while rendering.");
	}
	function useActionState(action, initialState, permalink) {
		resolveCurrentlyRenderingComponent();
		var actionStateHookIndex = actionStateCounter++, request = currentlyRenderingRequest;
		if ("function" === typeof action.$$FORM_ACTION) {
			var nextPostbackStateKey = null, componentKeyPath = currentlyRenderingKeyPath;
			request = request.formState;
			var isSignatureEqual = action.$$IS_SIGNATURE_EQUAL;
			if (null !== request && "function" === typeof isSignatureEqual) {
				var postbackKey = request[1];
				isSignatureEqual.call(action, request[2], request[3]) && (nextPostbackStateKey = void 0 !== permalink ? "p" + permalink : "k" + murmurhash3_32_gc(JSON.stringify([
					componentKeyPath,
					null,
					actionStateHookIndex
				]), 0), postbackKey === nextPostbackStateKey && (actionStateMatchingIndex = actionStateHookIndex, initialState = request[0]));
			}
			var boundAction = action.bind(null, initialState);
			action = function(payload) {
				boundAction(payload);
			};
			"function" === typeof boundAction.$$FORM_ACTION && (action.$$FORM_ACTION = function(prefix) {
				prefix = boundAction.$$FORM_ACTION(prefix);
				void 0 !== permalink && (permalink += "", prefix.action = permalink);
				var formData = prefix.data;
				formData && (null === nextPostbackStateKey && (nextPostbackStateKey = void 0 !== permalink ? "p" + permalink : "k" + murmurhash3_32_gc(JSON.stringify([
					componentKeyPath,
					null,
					actionStateHookIndex
				]), 0)), formData.append("$ACTION_KEY", nextPostbackStateKey));
				return prefix;
			});
			return [
				initialState,
				action,
				!1
			];
		}
		var boundAction$22 = action.bind(null, initialState);
		return [
			initialState,
			function(payload) {
				boundAction$22(payload);
			},
			!1
		];
	}
	function unwrapThenable(thenable) {
		var index = thenableIndexCounter;
		thenableIndexCounter += 1;
		null === thenableState && (thenableState = []);
		return trackUsedThenable(thenableState, thenable, index);
	}
	function unsupportedRefresh() {
		throw Error("Cache cannot be refreshed during server rendering.");
	}
	var HooksDispatcher = {
		readContext: function(context) {
			return context._currentValue2;
		},
		use: function(usable) {
			if (null !== usable && "object" === typeof usable) {
				if ("function" === typeof usable.then) return unwrapThenable(usable);
				if (usable.$$typeof === REACT_RECOVERABLE_TYPE) throw createRecoverableError(usable);
				if (usable.$$typeof === REACT_CONTEXT_TYPE) return usable._currentValue2;
			}
			throw Error("An unsupported type was passed to use(): " + String(usable));
		},
		useContext: function(context) {
			resolveCurrentlyRenderingComponent();
			return context._currentValue2;
		},
		useMemo,
		useReducer,
		useRef: function(initialValue) {
			currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
			workInProgressHook = createWorkInProgressHook();
			var previousRef = workInProgressHook.memoizedState;
			return null === previousRef ? (initialValue = { current: initialValue }, workInProgressHook.memoizedState = initialValue) : previousRef;
		},
		useState: function(initialState) {
			return useReducer(basicStateReducer, initialState);
		},
		useInsertionEffect: noop,
		useLayoutEffect: noop,
		useCallback: function(callback, deps) {
			return useMemo(function() {
				return callback;
			}, deps);
		},
		useImperativeHandle: noop,
		useEffect: noop,
		useDebugValue: noop,
		useDeferredValue: function(value, initialValue) {
			resolveCurrentlyRenderingComponent();
			return void 0 !== initialValue ? initialValue : value;
		},
		useTransition: function() {
			resolveCurrentlyRenderingComponent();
			return [!1, unsupportedStartTransition];
		},
		useId: function() {
			var treeId = getTreeId(currentlyRenderingTask.treeContext), resumableState = currentResumableState;
			if (null === resumableState) throw Error("Invalid hook call. Hooks can only be called inside of the body of a function component.");
			return makeId(resumableState, treeId, localIdCounter++);
		},
		useSyncExternalStore: function(subscribe, getSnapshot, getServerSnapshot) {
			if (void 0 === getServerSnapshot) throw Error("Missing getServerSnapshot, which is required for server-rendered content. Will revert to client rendering.");
			return getServerSnapshot();
		},
		useOptimistic: function(passthrough) {
			resolveCurrentlyRenderingComponent();
			return [passthrough, unsupportedSetOptimisticState];
		},
		useActionState,
		useFormState: useActionState,
		useHostTransitionStatus: function() {
			resolveCurrentlyRenderingComponent();
			return sharedNotPendingObject;
		},
		useMemoCache: function(size) {
			for (var data = Array(size), i = 0; i < size; i++) data[i] = REACT_MEMO_CACHE_SENTINEL;
			return data;
		},
		useCacheRefresh: function() {
			return unsupportedRefresh;
		},
		useEffectEvent: function() {
			return throwOnUseEffectEventCall;
		}
	};
	var currentResumableState = null;
	var DefaultAsyncDispatcher = {
		getCacheForType: function() {
			throw Error("Not implemented.");
		},
		cacheSignal: function() {
			throw Error("Not implemented.");
		}
	};
	var prefix;
	var suffix;
	function describeBuiltInComponentFrame(name) {
		if (void 0 === prefix) try {
			throw Error();
		} catch (x) {
			var match = x.stack.trim().match(/\n( *(at )?)/);
			prefix = match && match[1] || "";
			suffix = -1 < x.stack.indexOf("\n    at") ? " (<anonymous>)" : -1 < x.stack.indexOf("@") ? "@unknown:0:0" : "";
		}
		return "\n" + prefix + name + suffix;
	}
	var reentry = !1;
	function describeNativeComponentFrame(fn, construct) {
		if (!fn || reentry) return "";
		reentry = !0;
		var previousPrepareStackTrace = Error.prepareStackTrace;
		Error.prepareStackTrace = void 0;
		try {
			var RunInRootFrame = { DetermineComponentFrameRoot: function() {
				try {
					if (construct) {
						var Fake = function() {
							throw Error();
						};
						Object.defineProperty(Fake.prototype, "props", { set: function() {
							throw Error();
						} });
						if ("object" === typeof Reflect && Reflect.construct) {
							try {
								Reflect.construct(Fake, []);
							} catch (x) {
								var control = x;
							}
							Reflect.construct(fn, [], Fake);
						} else {
							try {
								Fake.call();
							} catch (x$24) {
								control = x$24;
							}
							Fake = !1;
							try {
								var prevProps = Object.getOwnPropertyDescriptor(fn.prototype, "props");
								Object.defineProperty(fn.prototype, "props", {
									configurable: !0,
									set: function() {
										throw Error();
									}
								});
								Fake = !0;
								new fn();
							} finally {
								Fake && (void 0 !== prevProps ? Object.defineProperty(fn.prototype, "props", prevProps) : delete fn.prototype.props);
							}
						}
					} else {
						try {
							throw Error();
						} catch (x$25) {
							control = x$25;
						}
						(Fake = fn()) && "function" === typeof Fake.catch && Fake.catch(function() {});
					}
				} catch (sample) {
					if (sample && control && "string" === typeof sample.stack) return [sample.stack, control.stack];
				}
				return [null, null];
			} };
			RunInRootFrame.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
			var namePropDescriptor = Object.getOwnPropertyDescriptor(RunInRootFrame.DetermineComponentFrameRoot, "name");
			namePropDescriptor && namePropDescriptor.configurable && Object.defineProperty(RunInRootFrame.DetermineComponentFrameRoot, "name", { value: "DetermineComponentFrameRoot" });
			var _RunInRootFrame$Deter = RunInRootFrame.DetermineComponentFrameRoot(), sampleStack = _RunInRootFrame$Deter[0], controlStack = _RunInRootFrame$Deter[1];
			if (sampleStack && controlStack) {
				var sampleLines = sampleStack.split("\n"), controlLines = controlStack.split("\n");
				for (namePropDescriptor = RunInRootFrame = 0; RunInRootFrame < sampleLines.length && !sampleLines[RunInRootFrame].includes("DetermineComponentFrameRoot");) RunInRootFrame++;
				for (; namePropDescriptor < controlLines.length && !controlLines[namePropDescriptor].includes("DetermineComponentFrameRoot");) namePropDescriptor++;
				if (RunInRootFrame === sampleLines.length || namePropDescriptor === controlLines.length) for (RunInRootFrame = sampleLines.length - 1, namePropDescriptor = controlLines.length - 1; 1 <= RunInRootFrame && 0 <= namePropDescriptor && sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor];) namePropDescriptor--;
				for (; 1 <= RunInRootFrame && 0 <= namePropDescriptor; RunInRootFrame--, namePropDescriptor--) if (sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor]) {
					if (1 !== RunInRootFrame || 1 !== namePropDescriptor) do
						if (RunInRootFrame--, namePropDescriptor--, 0 > namePropDescriptor || sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor]) {
							var frame = "\n" + sampleLines[RunInRootFrame].replace(" at new ", " at ");
							fn.displayName && frame.includes("<anonymous>") && (frame = frame.replace("<anonymous>", fn.displayName));
							return frame;
						}
					while (1 <= RunInRootFrame && 0 <= namePropDescriptor);
					break;
				}
			}
		} finally {
			reentry = !1, Error.prepareStackTrace = previousPrepareStackTrace;
		}
		return (previousPrepareStackTrace = fn ? fn.displayName || fn.name : "") ? describeBuiltInComponentFrame(previousPrepareStackTrace) : "";
	}
	function describeComponentStackByType(type) {
		if ("string" === typeof type) return describeBuiltInComponentFrame(type);
		if ("function" === typeof type) return type.prototype && type.prototype.isReactComponent ? describeNativeComponentFrame(type, !0) : describeNativeComponentFrame(type, !1);
		if ("object" === typeof type && null !== type) {
			switch (type.$$typeof) {
				case REACT_FORWARD_REF_TYPE: return describeNativeComponentFrame(type.render, !1);
				case REACT_MEMO_TYPE: return describeNativeComponentFrame(type.type, !1);
				case REACT_LAZY_TYPE:
					var lazyComponent = type, payload = lazyComponent._payload;
					lazyComponent = lazyComponent._init;
					try {
						type = lazyComponent(payload);
					} catch (x) {
						return describeBuiltInComponentFrame("Lazy");
					}
					return describeComponentStackByType(type);
			}
			if ("string" === typeof type.name) {
				a: {
					payload = type.name;
					lazyComponent = type.env;
					var location = type.debugLocation;
					if (null != location && (type = Error.prepareStackTrace, Error.prepareStackTrace = void 0, location = location.stack, Error.prepareStackTrace = type, location.startsWith("Error: react-stack-top-frame\n") && (location = location.slice(29)), type = location.indexOf("\n"), -1 !== type && (location = location.slice(type + 1)), type = location.indexOf("react_stack_bottom_frame"), -1 !== type && (type = location.lastIndexOf("\n", type)), type = -1 !== type ? location = location.slice(0, type) : "", location = type.lastIndexOf("\n"), type = -1 === location ? type : type.slice(location + 1), -1 !== type.indexOf(payload))) {
						payload = "\n" + type;
						break a;
					}
					payload = describeBuiltInComponentFrame(payload + (lazyComponent ? " [" + lazyComponent + "]" : ""));
				}
				return payload;
			}
		}
		switch (type) {
			case REACT_SUSPENSE_LIST_TYPE: return describeBuiltInComponentFrame("SuspenseList");
			case REACT_SUSPENSE_TYPE: return describeBuiltInComponentFrame("Suspense");
			case REACT_VIEW_TRANSITION_TYPE: return describeBuiltInComponentFrame("ViewTransition");
		}
		return "";
	}
	function isEligibleForOutlining(request, boundary) {
		return (500 < boundary.byteSize || boundary.defer) && null === boundary.preamble;
	}
	function defaultErrorHandler(error) {
		if ("object" === typeof error && null !== error && "string" === typeof error.environmentName) {
			var JSCompiler_inline_result = error.environmentName;
			error = [error].slice(0);
			"string" === typeof error[0] ? error.splice(0, 1, "[%s] " + error[0], " " + JSCompiler_inline_result + " ") : error.splice(0, 0, "[%s]", " " + JSCompiler_inline_result + " ");
			error.unshift(console);
			JSCompiler_inline_result = bind.apply(console.error, error);
			JSCompiler_inline_result();
		} else console.error(error);
		return null;
	}
	function RequestInstance(resumableState, renderState, rootFormatContext, progressiveChunkSize, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError, formState) {
		var abortSet = /* @__PURE__ */ new Set();
		this.destination = null;
		this.flushScheduled = !1;
		this.resumableState = resumableState;
		this.renderState = renderState;
		this.rootFormatContext = rootFormatContext;
		this.progressiveChunkSize = void 0 === progressiveChunkSize ? 12800 : progressiveChunkSize;
		this.status = 10;
		this.fatalError = null;
		this.aborted = !1;
		this.pendingRootTasks = this.allPendingTasks = this.nextSegmentId = 0;
		this.completedPreambleSegments = this.completedRootSegment = null;
		this.byteSize = 0;
		this.abortableTasks = abortSet;
		this.pingedTasks = [];
		this.currentTask = null;
		this.clientRenderedBoundaries = [];
		this.completedBoundaries = [];
		this.partialBoundaries = [];
		this.postponedState = this.trackedPostpones = null;
		this.onError = void 0 === onError ? defaultErrorHandler : onError;
		this.onBrowserBailout = void 0 === onBrowserBailout ? noop : onBrowserBailout;
		this.onAllReady = void 0 === onAllReady ? noop : onAllReady;
		this.onShellReady = void 0 === onShellReady ? noop : onShellReady;
		this.onShellError = void 0 === onShellError ? noop : onShellError;
		this.onFatalError = void 0 === onFatalError ? noop : onFatalError;
		this.renderLifetimeController = null;
		this.formState = void 0 === formState ? null : formState;
	}
	function createRequest(children, resumableState, renderState, rootFormatContext, progressiveChunkSize, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError, formState) {
		resumableState = new RequestInstance(resumableState, renderState, rootFormatContext, progressiveChunkSize, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError, formState);
		renderState = createPendingSegment(resumableState, 0, null, rootFormatContext, !1, !1);
		renderState.parentFlushed = !0;
		children = createRenderTask(resumableState, null, children, -1, null, renderState, null, null, resumableState.abortableTasks, null, rootFormatContext, null, emptyTreeContext, null, null);
		pushComponentStack(children);
		resumableState.pingedTasks.push(children);
		return resumableState;
	}
	var currentRequest = null;
	function pingTask(request, task) {
		request.pingedTasks.push(task);
		1 === request.pingedTasks.length && (request.flushScheduled = null !== request.destination, performWork(request));
	}
	function createSuspenseBoundary(request, row, fallbackAbortableTasks, preamble, defer) {
		fallbackAbortableTasks = {
			status: 0,
			rootSegmentID: -1,
			parentFlushed: !1,
			pendingTasks: 0,
			row,
			completedSegments: [],
			byteSize: 0,
			defer,
			fallbackAbortableTasks,
			errorDigest: null,
			contentState: createHoistableState(),
			fallbackState: createHoistableState(),
			preamble,
			tracked: null
		};
		null !== row && (row.pendingTasks++, preamble = row.boundaries, null !== preamble && (request.allPendingTasks++, fallbackAbortableTasks.pendingTasks++, preamble.push(fallbackAbortableTasks)), request = row.inheritedHoistables, null !== request && hoistHoistables(fallbackAbortableTasks.contentState, request));
		return fallbackAbortableTasks;
	}
	function createRenderTask(request, thenableState, node, childIndex, blockedBoundary, blockedSegment, blockedPreamble, hoistableState, abortSet, keyPath, formatContext, context, treeContext, row, componentStack) {
		request.allPendingTasks++;
		null === blockedBoundary ? request.pendingRootTasks++ : blockedBoundary.pendingTasks++;
		null !== row && row.pendingTasks++;
		var task = {
			replay: null,
			node,
			childIndex,
			ping: {
				resolve: function() {
					return pingTask(request, task);
				},
				reject: function(error) {
					request.aborted ? task.abortSet.delete(task) && finishAbortedTask(task, request, error) : pingTask(request, task);
				}
			},
			blockedBoundary,
			blockedSegment,
			blockedPreamble,
			hoistableState,
			abortSet,
			keyPath,
			formatContext,
			context,
			treeContext,
			row,
			componentStack,
			thenableState
		};
		abortSet.add(task);
		return task;
	}
	function createReplayTask(request, thenableState, replay, node, childIndex, blockedBoundary, hoistableState, abortSet, keyPath, formatContext, context, treeContext, row, componentStack) {
		request.allPendingTasks++;
		null === blockedBoundary ? request.pendingRootTasks++ : blockedBoundary.pendingTasks++;
		null !== row && row.pendingTasks++;
		replay.pendingTasks++;
		var task = {
			replay,
			node,
			childIndex,
			ping: {
				resolve: function() {
					return pingTask(request, task);
				},
				reject: function(error) {
					request.aborted ? task.abortSet.delete(task) && finishAbortedTask(task, request, error) : pingTask(request, task);
				}
			},
			blockedBoundary,
			blockedSegment: null,
			blockedPreamble: null,
			hoistableState,
			abortSet,
			keyPath,
			formatContext,
			context,
			treeContext,
			row,
			componentStack,
			thenableState
		};
		abortSet.add(task);
		return task;
	}
	function createPendingSegment(request, index, boundary, parentFormatContext, lastPushedText, textEmbedded) {
		return {
			status: 0,
			parentFlushed: !1,
			id: -1,
			index,
			chunks: [],
			children: [],
			preambleChildren: [],
			parentFormatContext,
			boundary,
			lastPushedText,
			textEmbedded
		};
	}
	function pushComponentStack(task) {
		var node = task.node;
		if ("object" === typeof node && null !== node) switch (node.$$typeof) {
			case REACT_ELEMENT_TYPE: task.componentStack = {
				parent: task.componentStack,
				type: node.type
			};
		}
	}
	function replaceSuspenseComponentStackWithSuspenseFallbackStack(componentStack) {
		return null === componentStack ? null : {
			parent: componentStack.parent,
			type: "Suspense Fallback"
		};
	}
	function getThrownInfo(node$jscomp$0) {
		var errorInfo = {};
		node$jscomp$0 && Object.defineProperty(errorInfo, "componentStack", {
			configurable: !0,
			enumerable: !0,
			get: function() {
				try {
					var info = "", node = node$jscomp$0;
					do
						info += describeComponentStackByType(node.type), node = node.parent;
					while (node);
					var JSCompiler_inline_result = info;
				} catch (x) {
					JSCompiler_inline_result = "\nError generating stack: " + x.message + "\n" + x.stack;
				}
				Object.defineProperty(errorInfo, "componentStack", { value: JSCompiler_inline_result });
				return JSCompiler_inline_result;
			}
		});
		return errorInfo;
	}
	function logRecoverableError(request, error, errorInfo) {
		if (isRecoverableError(error)) return request = request.onBrowserBailout, request(error, errorInfo), "";
		request = request.onError;
		error = request(error, errorInfo);
		if (null == error || "string" === typeof error) return "" === error ? void 0 : error;
	}
	function fatalError(request, error) {
		var onShellError = request.onShellError, onFatalError = request.onFatalError;
		0 !== request.pendingRootTasks && onShellError(error);
		onFatalError(error);
		endRenderLifetime(request);
		null !== request.destination ? (request.status = 13, request.destination.destroy(error)) : (request.status = 12, request.aborted || (request.fatalError = error));
	}
	function finishSuspenseListRow(request, row) {
		unblockSuspenseListRow(request, row.next, row.hoistables);
	}
	function unblockSuspenseListRow(request, unblockedRow, inheritedHoistables) {
		for (; null !== unblockedRow;) {
			null !== inheritedHoistables && (hoistHoistables(unblockedRow.hoistables, inheritedHoistables), unblockedRow.inheritedHoistables = inheritedHoistables);
			var unblockedBoundaries = unblockedRow.boundaries;
			if (null !== unblockedBoundaries) {
				unblockedRow.boundaries = null;
				for (var i = 0; i < unblockedBoundaries.length; i++) {
					var unblockedBoundary = unblockedBoundaries[i];
					null !== inheritedHoistables && hoistHoistables(unblockedBoundary.contentState, inheritedHoistables);
					finishedTask(request, unblockedBoundary, null, null);
				}
			}
			unblockedRow.pendingTasks--;
			if (0 < unblockedRow.pendingTasks) break;
			inheritedHoistables = unblockedRow.hoistables;
			unblockedRow = unblockedRow.next;
		}
	}
	function tryToResolveTogetherRow(request, togetherRow) {
		var boundaries = togetherRow.boundaries;
		if (null !== boundaries && togetherRow.pendingTasks === boundaries.length) {
			for (var allCompleteAndInlinable = !0, i = 0; i < boundaries.length; i++) {
				var rowBoundary = boundaries[i];
				if (1 !== rowBoundary.pendingTasks || rowBoundary.parentFlushed || isEligibleForOutlining(request, rowBoundary)) {
					allCompleteAndInlinable = !1;
					break;
				}
			}
			allCompleteAndInlinable && unblockSuspenseListRow(request, togetherRow, togetherRow.hoistables);
		}
	}
	function createSuspenseListRow(previousRow) {
		var newRow = {
			pendingTasks: 1,
			boundaries: null,
			hoistables: createHoistableState(),
			inheritedHoistables: null,
			together: !1,
			next: null
		};
		null !== previousRow && 0 < previousRow.pendingTasks && (newRow.pendingTasks++, newRow.boundaries = [], previousRow.next = newRow);
		return newRow;
	}
	function renderSuspenseListRows(request, task, keyPath, rows, revealOrder) {
		var prevKeyPath = task.keyPath, prevTreeContext = task.treeContext, prevRow = task.row;
		task.keyPath = keyPath;
		keyPath = rows.length;
		var previousSuspenseListRow = null;
		if (null !== task.replay) {
			var resumeSlots = task.replay.slots;
			if (null !== resumeSlots && "object" === typeof resumeSlots) for (var n = 0; n < keyPath; n++) {
				var i = "backwards" !== revealOrder && "unstable_legacy-backwards" !== revealOrder ? n : keyPath - 1 - n, node = rows[i];
				task.row = previousSuspenseListRow = createSuspenseListRow(previousSuspenseListRow);
				task.treeContext = pushTreeContext(prevTreeContext, keyPath, i);
				var resumeSegmentID = resumeSlots[i];
				"number" === typeof resumeSegmentID ? (resumeNode(request, task, resumeSegmentID, node, i), delete resumeSlots[i]) : renderNode(request, task, node, i);
				0 === --previousSuspenseListRow.pendingTasks && finishSuspenseListRow(request, previousSuspenseListRow);
			}
			else for (resumeSlots = 0; resumeSlots < keyPath; resumeSlots++) n = "backwards" !== revealOrder && "unstable_legacy-backwards" !== revealOrder ? resumeSlots : keyPath - 1 - resumeSlots, i = rows[n], task.row = previousSuspenseListRow = createSuspenseListRow(previousSuspenseListRow), task.treeContext = pushTreeContext(prevTreeContext, keyPath, n), renderNode(request, task, i, n), 0 === --previousSuspenseListRow.pendingTasks && finishSuspenseListRow(request, previousSuspenseListRow);
		} else if ("backwards" !== revealOrder && "unstable_legacy-backwards" !== revealOrder) for (revealOrder = 0; revealOrder < keyPath; revealOrder++) resumeSlots = rows[revealOrder], task.row = previousSuspenseListRow = createSuspenseListRow(previousSuspenseListRow), task.treeContext = pushTreeContext(prevTreeContext, keyPath, revealOrder), renderNode(request, task, resumeSlots, revealOrder), 0 === --previousSuspenseListRow.pendingTasks && finishSuspenseListRow(request, previousSuspenseListRow);
		else {
			resumeSlots = task.blockedSegment;
			n = resumeSlots.children.length;
			i = resumeSlots.chunks.length;
			for (node = 0; node < keyPath; node++) {
				resumeSegmentID = "unstable_legacy-backwards" === revealOrder ? keyPath - 1 - node : node;
				var node$39 = rows[resumeSegmentID];
				task.row = previousSuspenseListRow = createSuspenseListRow(previousSuspenseListRow);
				task.treeContext = pushTreeContext(prevTreeContext, keyPath, resumeSegmentID);
				var newSegment = createPendingSegment(request, i, null, task.formatContext, 0 === resumeSegmentID ? resumeSlots.lastPushedText : !0, !0);
				resumeSlots.children.splice(n, 0, newSegment);
				task.blockedSegment = newSegment;
				try {
					renderNode(request, task, node$39, resumeSegmentID), pushSegmentFinale(newSegment.chunks, request.renderState, newSegment.lastPushedText, newSegment.textEmbedded), newSegment.status = 1, 0 === --previousSuspenseListRow.pendingTasks && finishSuspenseListRow(request, previousSuspenseListRow);
				} catch (thrownValue) {
					throw newSegment.status = request.aborted ? 3 : 4, thrownValue;
				}
			}
			task.blockedSegment = resumeSlots;
			resumeSlots.lastPushedText = !1;
		}
		null !== prevRow && null !== previousSuspenseListRow && 0 < previousSuspenseListRow.pendingTasks && (prevRow.pendingTasks++, previousSuspenseListRow.next = prevRow);
		task.treeContext = prevTreeContext;
		task.row = prevRow;
		task.keyPath = prevKeyPath;
	}
	function renderWithHooks(request, task, keyPath, Component, props, secondArg) {
		var prevThenableState = task.thenableState;
		task.thenableState = null;
		currentlyRenderingComponent = {};
		currentlyRenderingTask = task;
		currentlyRenderingRequest = request;
		currentlyRenderingKeyPath = keyPath;
		actionStateCounter = localIdCounter = 0;
		actionStateMatchingIndex = -1;
		thenableIndexCounter = 0;
		thenableState = prevThenableState;
		for (request = Component(props, secondArg); didScheduleRenderPhaseUpdate;) didScheduleRenderPhaseUpdate = !1, actionStateCounter = localIdCounter = 0, actionStateMatchingIndex = -1, thenableIndexCounter = 0, numberOfReRenders += 1, workInProgressHook = null, request = Component(props, secondArg);
		resetHooksState();
		return request;
	}
	function finishFunctionComponent(request, task, keyPath, children, hasId, actionStateCount, actionStateMatchingIndex) {
		var didEmitActionStateMarkers = !1;
		if (0 !== actionStateCount && null !== request.formState) {
			var segment = task.blockedSegment;
			if (null !== segment) {
				didEmitActionStateMarkers = !0;
				segment = segment.chunks;
				for (var i = 0; i < actionStateCount; i++) i === actionStateMatchingIndex ? segment.push("<!--F!-->") : segment.push("<!--F-->");
			}
		}
		actionStateCount = task.keyPath;
		task.keyPath = keyPath;
		hasId ? (keyPath = task.treeContext, task.treeContext = pushTreeContext(keyPath, 1, 0), renderNode(request, task, children, -1), task.treeContext = keyPath) : didEmitActionStateMarkers ? renderNode(request, task, children, -1) : renderNodeDestructive(request, task, children, -1);
		task.keyPath = actionStateCount;
	}
	function renderElement(request, task, keyPath, type, props, ref) {
		if ("function" === typeof type) if (type.prototype && type.prototype.isReactComponent) {
			var newProps = props;
			if ("ref" in props) {
				newProps = {};
				for (var propName in props) "ref" !== propName && (newProps[propName] = props[propName]);
			}
			var defaultProps = type.defaultProps;
			if (defaultProps) {
				newProps === props && (newProps = assign({}, newProps, props));
				for (var propName$44 in defaultProps) void 0 === newProps[propName$44] && (newProps[propName$44] = defaultProps[propName$44]);
			}
			var JSCompiler_inline_result = newProps;
			var context = emptyContextObject, contextType = type.contextType;
			"object" === typeof contextType && null !== contextType && (context = contextType._currentValue2);
			var JSCompiler_inline_result$jscomp$0 = new type(JSCompiler_inline_result, context);
			var initialState = void 0 !== JSCompiler_inline_result$jscomp$0.state ? JSCompiler_inline_result$jscomp$0.state : null;
			JSCompiler_inline_result$jscomp$0.updater = classComponentUpdater;
			JSCompiler_inline_result$jscomp$0.props = JSCompiler_inline_result;
			JSCompiler_inline_result$jscomp$0.state = initialState;
			var internalInstance = {
				queue: [],
				replace: !1
			};
			JSCompiler_inline_result$jscomp$0._reactInternals = internalInstance;
			var contextType$jscomp$0 = type.contextType;
			JSCompiler_inline_result$jscomp$0.context = "object" === typeof contextType$jscomp$0 && null !== contextType$jscomp$0 ? contextType$jscomp$0._currentValue2 : emptyContextObject;
			var getDerivedStateFromProps = type.getDerivedStateFromProps;
			if ("function" === typeof getDerivedStateFromProps) {
				var partialState = getDerivedStateFromProps(JSCompiler_inline_result, initialState);
				JSCompiler_inline_result$jscomp$0.state = null === partialState || void 0 === partialState ? initialState : assign({}, initialState, partialState);
			}
			if ("function" !== typeof type.getDerivedStateFromProps && "function" !== typeof JSCompiler_inline_result$jscomp$0.getSnapshotBeforeUpdate && ("function" === typeof JSCompiler_inline_result$jscomp$0.UNSAFE_componentWillMount || "function" === typeof JSCompiler_inline_result$jscomp$0.componentWillMount)) {
				var oldState = JSCompiler_inline_result$jscomp$0.state;
				"function" === typeof JSCompiler_inline_result$jscomp$0.componentWillMount && JSCompiler_inline_result$jscomp$0.componentWillMount();
				"function" === typeof JSCompiler_inline_result$jscomp$0.UNSAFE_componentWillMount && JSCompiler_inline_result$jscomp$0.UNSAFE_componentWillMount();
				oldState !== JSCompiler_inline_result$jscomp$0.state && classComponentUpdater.enqueueReplaceState(JSCompiler_inline_result$jscomp$0, JSCompiler_inline_result$jscomp$0.state, null);
				if (null !== internalInstance.queue && 0 < internalInstance.queue.length) {
					var oldQueue = internalInstance.queue, oldReplace = internalInstance.replace;
					internalInstance.queue = null;
					internalInstance.replace = !1;
					if (oldReplace && 1 === oldQueue.length) JSCompiler_inline_result$jscomp$0.state = oldQueue[0];
					else {
						for (var nextState = oldReplace ? oldQueue[0] : JSCompiler_inline_result$jscomp$0.state, dontMutate = !0, i = oldReplace ? 1 : 0; i < oldQueue.length; i++) {
							var partial = oldQueue[i], partialState$jscomp$0 = "function" === typeof partial ? partial.call(JSCompiler_inline_result$jscomp$0, nextState, JSCompiler_inline_result, void 0) : partial;
							null != partialState$jscomp$0 && (dontMutate ? (dontMutate = !1, nextState = assign({}, nextState, partialState$jscomp$0)) : assign(nextState, partialState$jscomp$0));
						}
						JSCompiler_inline_result$jscomp$0.state = nextState;
					}
				} else internalInstance.queue = null;
			}
			var nextChildren = JSCompiler_inline_result$jscomp$0.render();
			if (request.aborted) throw null;
			var prevKeyPath = task.keyPath;
			task.keyPath = keyPath;
			renderNodeDestructive(request, task, nextChildren, -1);
			task.keyPath = prevKeyPath;
		} else {
			var value = renderWithHooks(request, task, keyPath, type, props, void 0);
			if (request.aborted) throw null;
			finishFunctionComponent(request, task, keyPath, value, 0 !== localIdCounter, actionStateCounter, actionStateMatchingIndex);
		}
		else if ("string" === typeof type) {
			var segment = task.blockedSegment;
			if (null === segment) {
				var children = props.children, prevContext = task.formatContext, prevKeyPath$jscomp$0 = task.keyPath;
				task.formatContext = getChildFormatContext(prevContext, type, props);
				task.keyPath = keyPath;
				renderNode(request, task, children, -1);
				task.formatContext = prevContext;
				task.keyPath = prevKeyPath$jscomp$0;
			} else {
				var children$41 = pushStartInstance(segment.chunks, type, props, request.resumableState, request.renderState, task.blockedPreamble, task.hoistableState, task.formatContext, segment.lastPushedText);
				segment.lastPushedText = !1;
				var prevContext$42 = task.formatContext, prevKeyPath$43 = task.keyPath;
				task.keyPath = keyPath;
				if (3 === (task.formatContext = getChildFormatContext(prevContext$42, type, props)).insertionMode) {
					var preambleSegment = createPendingSegment(request, 0, null, task.formatContext, !1, !1);
					segment.preambleChildren.push(preambleSegment);
					task.blockedSegment = preambleSegment;
					try {
						renderNode(request, task, children$41, -1), pushSegmentFinale(preambleSegment.chunks, request.renderState, preambleSegment.lastPushedText, preambleSegment.textEmbedded), preambleSegment.status = 1;
					} finally {
						task.blockedSegment = segment;
					}
				} else renderNode(request, task, children$41, -1);
				task.formatContext = prevContext$42;
				task.keyPath = prevKeyPath$43;
				a: {
					var target = segment.chunks, resumableState = request.resumableState;
					switch (type) {
						case "title":
						case "style":
						case "script":
						case "area":
						case "base":
						case "br":
						case "col":
						case "embed":
						case "hr":
						case "img":
						case "input":
						case "keygen":
						case "link":
						case "meta":
						case "param":
						case "source":
						case "track":
						case "wbr": break a;
						case "body":
							if (1 >= prevContext$42.insertionMode) {
								resumableState.hasBody = !0;
								break a;
							}
							break;
						case "html":
							if (0 === prevContext$42.insertionMode) {
								resumableState.hasHtml = !0;
								break a;
							}
							break;
						case "head": if (1 >= prevContext$42.insertionMode) break a;
					}
					target.push(endChunkForTag(type));
				}
				segment.lastPushedText = !1;
			}
		} else {
			switch (type) {
				case REACT_LEGACY_HIDDEN_TYPE:
				case REACT_STRICT_MODE_TYPE:
				case REACT_PROFILER_TYPE:
				case REACT_FRAGMENT_TYPE:
					var prevKeyPath$jscomp$1 = task.keyPath;
					task.keyPath = keyPath;
					renderNodeDestructive(request, task, props.children, -1);
					task.keyPath = prevKeyPath$jscomp$1;
					return;
				case REACT_ACTIVITY_TYPE:
					var segment$jscomp$0 = task.blockedSegment;
					if (null === segment$jscomp$0) {
						if ("hidden" !== props.mode) {
							var prevKeyPath$jscomp$2 = task.keyPath;
							task.keyPath = keyPath;
							renderNode(request, task, props.children, -1);
							task.keyPath = prevKeyPath$jscomp$2;
						}
					} else if ("hidden" !== props.mode) {
						request.renderState.generateStaticMarkup || segment$jscomp$0.chunks.push("<!--&-->");
						segment$jscomp$0.lastPushedText = !1;
						var prevKeyPath$46 = task.keyPath;
						task.keyPath = keyPath;
						renderNode(request, task, props.children, -1);
						task.keyPath = prevKeyPath$46;
						request.renderState.generateStaticMarkup || segment$jscomp$0.chunks.push("<!--/&-->");
						segment$jscomp$0.lastPushedText = !1;
					}
					return;
				case REACT_SUSPENSE_LIST_TYPE:
					a: {
						var children$jscomp$0 = props.children, revealOrder = props.revealOrder;
						if ("independent" !== revealOrder && "together" !== revealOrder) {
							if (isArrayImpl(children$jscomp$0)) {
								renderSuspenseListRows(request, task, keyPath, children$jscomp$0, revealOrder);
								break a;
							}
							var iteratorFn = getIteratorFn(children$jscomp$0);
							if (iteratorFn) {
								var iterator = iteratorFn.call(children$jscomp$0);
								if (iterator) {
									var step = iterator.next();
									if (!step.done) {
										do
											step = iterator.next();
										while (!step.done);
										renderSuspenseListRows(request, task, keyPath, children$jscomp$0, revealOrder);
									}
									break a;
								}
							}
						}
						if ("together" === revealOrder) {
							var prevKeyPath$40 = task.keyPath, prevRow = task.row, newRow = task.row = createSuspenseListRow(null);
							newRow.boundaries = [];
							newRow.together = !0;
							task.keyPath = keyPath;
							renderNodeDestructive(request, task, children$jscomp$0, -1);
							0 === --newRow.pendingTasks && finishSuspenseListRow(request, newRow);
							task.keyPath = prevKeyPath$40;
							task.row = prevRow;
							null !== prevRow && 0 < newRow.pendingTasks && (prevRow.pendingTasks++, newRow.next = prevRow);
						} else {
							var prevKeyPath$jscomp$3 = task.keyPath;
							task.keyPath = keyPath;
							renderNodeDestructive(request, task, children$jscomp$0, -1);
							task.keyPath = prevKeyPath$jscomp$3;
						}
					}
					return;
				case REACT_VIEW_TRANSITION_TYPE:
					var prevContext$jscomp$0 = task.formatContext, prevKeyPath$jscomp$4 = task.keyPath;
					var resumableState$jscomp$0 = request.resumableState;
					if (null == props.name || "auto" === props.name) makeId(resumableState$jscomp$0, getTreeId(task.treeContext), 0);
					task.formatContext = prevContext$jscomp$0;
					task.keyPath = keyPath;
					if (null != props.name && "auto" !== props.name) renderNodeDestructive(request, task, props.children, -1);
					else {
						var prevTreeContext = task.treeContext;
						task.treeContext = pushTreeContext(prevTreeContext, 1, 0);
						renderNode(request, task, props.children, -1);
						task.treeContext = prevTreeContext;
					}
					task.formatContext = prevContext$jscomp$0;
					task.keyPath = prevKeyPath$jscomp$4;
					return;
				case REACT_SCOPE_TYPE: throw Error("ReactDOMServer does not yet support scope components.");
				case REACT_SUSPENSE_TYPE:
					a: if (null !== task.replay) {
						var prevKeyPath$26 = task.keyPath, prevContext$27 = task.formatContext, prevRow$28 = task.row;
						task.keyPath = keyPath;
						task.formatContext = getSuspenseContentFormatContext(request.resumableState, prevContext$27);
						task.row = null;
						var content$29 = props.children;
						try {
							renderNode(request, task, content$29, -1);
						} finally {
							task.keyPath = prevKeyPath$26, task.formatContext = prevContext$27, task.row = prevRow$28;
						}
					} else {
						var prevKeyPath$jscomp$5 = task.keyPath, prevContext$jscomp$1 = task.formatContext, prevRow$jscomp$0 = task.row, parentBoundary = task.blockedBoundary, parentPreamble = task.blockedPreamble, parentHoistableState = task.hoistableState, parentSegment = task.blockedSegment, fallback = props.fallback, content = props.children, fallbackAbortSet = /* @__PURE__ */ new Set(), newBoundary = createSuspenseBoundary(request, task.row, fallbackAbortSet, null, !1), boundarySegment = createPendingSegment(request, parentSegment.chunks.length, newBoundary, task.formatContext, !1, !1);
						parentSegment.children.push(boundarySegment);
						parentSegment.lastPushedText = !1;
						var contentRootSegment = createPendingSegment(request, 0, null, task.formatContext, !1, !1);
						contentRootSegment.parentFlushed = !0;
						var trackedPostpones = request.trackedPostpones;
						if (null !== trackedPostpones) {
							var suspenseComponentStack = task.componentStack, fallbackKeyPath = [
								keyPath[0],
								"Suspense Fallback",
								keyPath[2]
							];
							if (null !== trackedPostpones) {
								var fallbackReplayNode = [
									fallbackKeyPath[1],
									fallbackKeyPath[2],
									[],
									null
								];
								trackedPostpones.workingMap.set(fallbackKeyPath, fallbackReplayNode);
								newBoundary.tracked = {
									contentKeyPath: keyPath,
									fallbackNode: fallbackReplayNode
								};
							}
							task.blockedSegment = boundarySegment;
							task.blockedPreamble = null === newBoundary.preamble ? null : newBoundary.preamble.fallback;
							task.keyPath = fallbackKeyPath;
							task.formatContext = getSuspenseFallbackFormatContext(request.resumableState, prevContext$jscomp$1);
							task.componentStack = replaceSuspenseComponentStackWithSuspenseFallbackStack(suspenseComponentStack);
							try {
								renderNode(request, task, fallback, -1), pushSegmentFinale(boundarySegment.chunks, request.renderState, boundarySegment.lastPushedText, boundarySegment.textEmbedded), boundarySegment.status = 1;
							} catch (thrownValue) {
								throw boundarySegment.status = request.aborted ? 3 : 4, thrownValue;
							} finally {
								task.blockedSegment = parentSegment, task.blockedPreamble = parentPreamble, task.keyPath = prevKeyPath$jscomp$5, task.formatContext = prevContext$jscomp$1;
							}
							var suspendedPrimaryTask = createRenderTask(request, null, content, -1, newBoundary, contentRootSegment, null === newBoundary.preamble ? null : newBoundary.preamble.content, newBoundary.contentState, task.abortSet, keyPath, getSuspenseContentFormatContext(request.resumableState, task.formatContext), task.context, task.treeContext, null, suspenseComponentStack);
							pushComponentStack(suspendedPrimaryTask);
							request.pingedTasks.push(suspendedPrimaryTask);
						} else {
							task.blockedBoundary = newBoundary;
							task.blockedPreamble = null === newBoundary.preamble ? null : newBoundary.preamble.content;
							task.hoistableState = newBoundary.contentState;
							task.blockedSegment = contentRootSegment;
							task.keyPath = keyPath;
							task.formatContext = getSuspenseContentFormatContext(request.resumableState, prevContext$jscomp$1);
							task.row = null;
							try {
								if (renderNode(request, task, content, -1), pushSegmentFinale(contentRootSegment.chunks, request.renderState, contentRootSegment.lastPushedText, contentRootSegment.textEmbedded), contentRootSegment.status = 1, queueCompletedSegment(newBoundary, contentRootSegment), 0 === newBoundary.pendingTasks && 0 === newBoundary.status) {
									if (newBoundary.status = 1, !isEligibleForOutlining(request, newBoundary)) {
										null !== prevRow$jscomp$0 && 0 === --prevRow$jscomp$0.pendingTasks && finishSuspenseListRow(request, prevRow$jscomp$0);
										0 === request.pendingRootTasks && task.blockedPreamble && preparePreamble(request);
										break a;
									}
								} else null !== prevRow$jscomp$0 && prevRow$jscomp$0.together && tryToResolveTogetherRow(request, prevRow$jscomp$0);
							} catch (thrownValue$30) {
								newBoundary.status = 4;
								if (request.aborted) {
									contentRootSegment.status = 3;
									var error = request.fatalError;
								} else contentRootSegment.status = 4, error = thrownValue$30;
								var thrownInfo = getThrownInfo(task.componentStack);
								newBoundary.errorDigest = logRecoverableError(request, error, thrownInfo);
								untrackBoundary(request, newBoundary);
							} finally {
								task.blockedBoundary = parentBoundary, task.blockedPreamble = parentPreamble, task.hoistableState = parentHoistableState, task.blockedSegment = parentSegment, task.keyPath = prevKeyPath$jscomp$5, task.formatContext = prevContext$jscomp$1, task.row = prevRow$jscomp$0;
							}
							var suspendedFallbackTask = createRenderTask(request, null, fallback, -1, parentBoundary, boundarySegment, null === newBoundary.preamble ? null : newBoundary.preamble.fallback, newBoundary.fallbackState, fallbackAbortSet, [
								keyPath[0],
								"Suspense Fallback",
								keyPath[2]
							], getSuspenseFallbackFormatContext(request.resumableState, task.formatContext), task.context, task.treeContext, task.row, replaceSuspenseComponentStackWithSuspenseFallbackStack(task.componentStack));
							pushComponentStack(suspendedFallbackTask);
							request.pingedTasks.push(suspendedFallbackTask);
						}
					}
					return;
			}
			if ("object" === typeof type && null !== type) switch (type.$$typeof) {
				case REACT_FORWARD_REF_TYPE:
					if ("ref" in props) {
						var propsWithoutRef = {};
						for (var key in props) "ref" !== key && (propsWithoutRef[key] = props[key]);
					} else propsWithoutRef = props;
					finishFunctionComponent(request, task, keyPath, renderWithHooks(request, task, keyPath, type.render, propsWithoutRef, ref), 0 !== localIdCounter, actionStateCounter, actionStateMatchingIndex);
					return;
				case REACT_MEMO_TYPE:
					renderElement(request, task, keyPath, type.type, props, ref);
					return;
				case REACT_CONTEXT_TYPE:
					var children$jscomp$2 = props.children, prevKeyPath$jscomp$6 = task.keyPath, nextValue = props.value;
					var prevValue = type._currentValue2;
					type._currentValue2 = nextValue;
					var prevNode = currentActiveSnapshot, newNode = {
						parent: prevNode,
						depth: null === prevNode ? 0 : prevNode.depth + 1,
						context: type,
						parentValue: prevValue,
						value: nextValue
					};
					currentActiveSnapshot = newNode;
					task.context = newNode;
					task.keyPath = keyPath;
					renderNodeDestructive(request, task, children$jscomp$2, -1);
					var prevSnapshot = currentActiveSnapshot;
					if (null === prevSnapshot) throw Error("Tried to pop a Context at the root of the app. This is a bug in React.");
					prevSnapshot.context._currentValue2 = prevSnapshot.parentValue;
					task.context = currentActiveSnapshot = prevSnapshot.parent;
					task.keyPath = prevKeyPath$jscomp$6;
					return;
				case REACT_CONSUMER_TYPE:
					var render = props.children, newChildren = render(type._context._currentValue2), prevKeyPath$jscomp$7 = task.keyPath;
					task.keyPath = keyPath;
					renderNodeDestructive(request, task, newChildren, -1);
					task.keyPath = prevKeyPath$jscomp$7;
					return;
				case REACT_LAZY_TYPE:
					var init = type._init;
					var Component = init(type._payload);
					if (request.aborted) throw null;
					renderElement(request, task, keyPath, Component, props, ref);
					return;
			}
			throw Error("Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: " + ((null == type ? type : typeof type) + "."));
		}
	}
	function resumeNode(request, task, segmentId, node, childIndex) {
		var prevReplay = task.replay, blockedBoundary = task.blockedBoundary, resumedSegment = createPendingSegment(request, 0, null, task.formatContext, !1, !1);
		resumedSegment.id = segmentId;
		resumedSegment.parentFlushed = !0;
		try {
			task.replay = null, task.blockedSegment = resumedSegment, renderNode(request, task, node, childIndex), resumedSegment.status = 1, null === blockedBoundary ? request.completedRootSegment = resumedSegment : (queueCompletedSegment(blockedBoundary, resumedSegment), blockedBoundary.parentFlushed && request.partialBoundaries.push(blockedBoundary));
		} finally {
			task.replay = prevReplay, task.blockedSegment = null;
		}
	}
	function renderNodeDestructive(request, task, node, childIndex) {
		null !== task.replay && "number" === typeof task.replay.slots ? resumeNode(request, task, task.replay.slots, node, childIndex) : (task.node = node, task.childIndex = childIndex, node = task.componentStack, pushComponentStack(task), retryNode(request, task), task.componentStack = node);
	}
	function retryNode(request, task) {
		var node = task.node, childIndex = task.childIndex;
		if (null !== node) {
			if ("object" === typeof node) {
				switch (node.$$typeof) {
					case REACT_ELEMENT_TYPE:
						var type = node.type, key = node.key, props = node.props;
						node = props.ref;
						var ref = void 0 !== node ? node : null, name = getComponentNameFromType(type), keyOrIndex = null == key || key === REACT_OPTIMISTIC_KEY ? -1 === childIndex ? 0 : childIndex : key;
						key = [
							task.keyPath,
							name,
							keyOrIndex
						];
						if (null !== task.replay) a: {
							var replay = task.replay;
							childIndex = replay.nodes;
							for (node = 0; node < childIndex.length; node++) {
								var node$jscomp$0 = childIndex[node];
								if (keyOrIndex === node$jscomp$0[1]) {
									if (4 === node$jscomp$0.length) {
										if (null !== name && name !== node$jscomp$0[0]) throw Error("Expected the resume to render <" + node$jscomp$0[0] + "> in this slot but instead it rendered <" + name + ">. The tree doesn't match so React will fallback to client rendering.");
										var childNodes = node$jscomp$0[2], childSlots = node$jscomp$0[3], currentNode = task.node;
										task.replay = {
											nodes: childNodes,
											slots: childSlots,
											pendingTasks: 1
										};
										try {
											renderElement(request, task, key, type, props, ref);
											if (1 === task.replay.pendingTasks && 0 < task.replay.nodes.length) throw Error("Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering.");
											task.replay.pendingTasks--;
										} catch (x) {
											if ("object" === typeof x && null !== x && (x === SuspenseException || "function" === typeof x.then || "Maximum call stack size exceeded" === x.message)) throw task.node === currentNode ? task.replay = replay : childIndex.splice(node, 1), x;
											task.replay.pendingTasks--;
											key = getThrownInfo(task.componentStack);
											currentNode = request;
											props = task.blockedBoundary;
											request = request.aborted ? request.fatalError : x;
											key = logRecoverableError(currentNode, request, key);
											abortRemainingReplayNodes(currentNode, props, childNodes, childSlots, request, key);
										}
										task.replay = replay;
									} else {
										if (type !== REACT_SUSPENSE_TYPE) throw Error("Expected the resume to render <Suspense> in this slot but instead it rendered <" + (getComponentNameFromType(type) || "Unknown") + ">. The tree doesn't match so React will fallback to client rendering.");
										b: {
											replay = node$jscomp$0[5];
											type = node$jscomp$0[2];
											ref = node$jscomp$0[3];
											name = null === node$jscomp$0[4] ? [] : node$jscomp$0[4][2];
											node$jscomp$0 = null === node$jscomp$0[4] ? null : node$jscomp$0[4][3];
											keyOrIndex = task.keyPath;
											var prevContext = task.formatContext, prevRow = task.row, previousReplaySet = task.replay, parentBoundary = task.blockedBoundary, parentHoistableState = task.hoistableState, content = props.children;
											props = props.fallback;
											var fallbackAbortSet = /* @__PURE__ */ new Set(), resumedBoundary = createSuspenseBoundary(request, task.row, fallbackAbortSet, null, !1);
											resumedBoundary.parentFlushed = !0;
											resumedBoundary.rootSegmentID = replay;
											task.blockedBoundary = resumedBoundary;
											task.hoistableState = resumedBoundary.contentState;
											task.keyPath = key;
											task.formatContext = getSuspenseContentFormatContext(request.resumableState, prevContext);
											task.row = null;
											task.replay = {
												nodes: type,
												slots: ref,
												pendingTasks: 1
											};
											try {
												renderNode(request, task, content, -1);
												if (1 === task.replay.pendingTasks && 0 < task.replay.nodes.length) throw Error("Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering.");
												task.replay.pendingTasks--;
												if (0 === resumedBoundary.pendingTasks && 0 === resumedBoundary.status) {
													resumedBoundary.status = 1;
													request.completedBoundaries.push(resumedBoundary);
													break b;
												}
											} catch (thrownValue) {
												resumedBoundary.status = 4, childNodes = request.aborted ? request.fatalError : thrownValue, childSlots = getThrownInfo(task.componentStack), currentNode = logRecoverableError(request, childNodes, childSlots), resumedBoundary.errorDigest = currentNode, task.replay.pendingTasks--, request.clientRenderedBoundaries.push(resumedBoundary);
											} finally {
												task.blockedBoundary = parentBoundary, task.hoistableState = parentHoistableState, task.replay = previousReplaySet, task.keyPath = keyOrIndex, task.formatContext = prevContext, task.row = prevRow;
											}
											childNodes = createReplayTask(request, null, {
												nodes: name,
												slots: node$jscomp$0,
												pendingTasks: 0
											}, props, -1, parentBoundary, resumedBoundary.fallbackState, fallbackAbortSet, [
												key[0],
												"Suspense Fallback",
												key[2]
											], getSuspenseFallbackFormatContext(request.resumableState, task.formatContext), task.context, task.treeContext, task.row, replaceSuspenseComponentStackWithSuspenseFallbackStack(task.componentStack));
											pushComponentStack(childNodes);
											request.pingedTasks.push(childNodes);
										}
									}
									childIndex.splice(node, 1);
									break a;
								}
							}
						}
						else renderElement(request, task, key, type, props, ref);
						return;
					case REACT_PORTAL_TYPE: throw Error("Portals are not currently supported by the server renderer. Render them conditionally so that they only appear on the client render.");
					case REACT_LAZY_TYPE:
						childNodes = node._init;
						node = childNodes(node._payload);
						if (request.aborted) throw null;
						renderNodeDestructive(request, task, node, childIndex);
						return;
				}
				if (isArrayImpl(node)) {
					renderChildrenArray(request, task, node, childIndex);
					return;
				}
				if (childNodes = getIteratorFn(node)) {
					if (childNodes = childNodes.call(node)) {
						node = childNodes.next();
						if (!node.done) {
							childSlots = [];
							do
								childSlots.push(node.value), node = childNodes.next();
							while (!node.done);
							renderChildrenArray(request, task, childSlots, childIndex);
						}
						return;
					}
				}
				if ("function" === typeof node.then) return task.thenableState = null, renderNodeDestructive(request, task, unwrapThenable(node), childIndex);
				if (node.$$typeof === REACT_CONTEXT_TYPE) return renderNodeDestructive(request, task, node._currentValue2, childIndex);
				childIndex = Object.prototype.toString.call(node);
				throw Error("Objects are not valid as a React child (found: " + ("[object Object]" === childIndex ? "object with keys {" + Object.keys(node).join(", ") + "}" : childIndex) + "). If you meant to render a collection of children, use an array instead.");
			}
			if ("string" === typeof node) childIndex = task.blockedSegment, null !== childIndex && (childIndex.lastPushedText = pushTextInstance(childIndex.chunks, node, request.renderState, childIndex.lastPushedText));
			else if ("number" === typeof node || "bigint" === typeof node) childIndex = task.blockedSegment, null !== childIndex && (childIndex.lastPushedText = pushTextInstance(childIndex.chunks, "" + node, request.renderState, childIndex.lastPushedText));
		}
	}
	function renderChildrenArray(request, task, children, childIndex) {
		var prevKeyPath = task.keyPath;
		if (-1 !== childIndex && (task.keyPath = [
			task.keyPath,
			"Fragment",
			childIndex
		], null !== task.replay)) {
			for (var replay = task.replay, replayNodes = replay.nodes, j = 0; j < replayNodes.length; j++) {
				var node = replayNodes[j];
				if (node[1] === childIndex) {
					childIndex = node[2];
					node = node[3];
					task.replay = {
						nodes: childIndex,
						slots: node,
						pendingTasks: 1
					};
					try {
						renderChildrenArray(request, task, children, -1);
						if (1 === task.replay.pendingTasks && 0 < task.replay.nodes.length) throw Error("Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering.");
						task.replay.pendingTasks--;
					} catch (x) {
						if ("object" === typeof x && null !== x && (x === SuspenseException || "function" === typeof x.then)) throw x;
						task.replay.pendingTasks--;
						var thrownInfo = getThrownInfo(task.componentStack);
						children = request;
						var boundary = task.blockedBoundary;
						request = request.aborted ? request.fatalError : x;
						thrownInfo = logRecoverableError(children, request, thrownInfo);
						abortRemainingReplayNodes(children, boundary, childIndex, node, request, thrownInfo);
					}
					task.replay = replay;
					replayNodes.splice(j, 1);
					break;
				}
			}
			task.keyPath = prevKeyPath;
			return;
		}
		replay = task.treeContext;
		replayNodes = children.length;
		if (null !== task.replay && (j = task.replay.slots, null !== j && "object" === typeof j)) {
			for (childIndex = 0; childIndex < replayNodes; childIndex++) node = children[childIndex], task.treeContext = pushTreeContext(replay, replayNodes, childIndex), boundary = j[childIndex], "number" === typeof boundary ? (resumeNode(request, task, boundary, node, childIndex), delete j[childIndex]) : renderNode(request, task, node, childIndex);
			task.treeContext = replay;
			task.keyPath = prevKeyPath;
			return;
		}
		for (j = 0; j < replayNodes; j++) childIndex = children[j], task.treeContext = pushTreeContext(replay, replayNodes, j), renderNode(request, task, childIndex, j);
		task.treeContext = replay;
		task.keyPath = prevKeyPath;
	}
	function trackPostponedBoundary(request, trackedPostpones, boundary) {
		boundary.status = 5;
		boundary.rootSegmentID = request.nextSegmentId++;
		var tracked = boundary.tracked;
		if (null === tracked) throw Error("It should not be possible to postpone at the root. This is a bug in React.");
		request = tracked.contentKeyPath;
		if (null === request) throw Error("It should not be possible to postpone at the root. This is a bug in React.");
		tracked = tracked.fallbackNode;
		var children = [], boundaryNode = trackedPostpones.workingMap.get(request);
		if (void 0 === boundaryNode) return boundary = [
			request[1],
			request[2],
			children,
			null,
			tracked,
			boundary.rootSegmentID
		], trackedPostpones.workingMap.set(request, boundary), addToReplayParent(boundary, request[0], trackedPostpones), boundary;
		boundaryNode[4] = tracked;
		boundaryNode[5] = boundary.rootSegmentID;
		return boundaryNode;
	}
	function trackPostpone(request, trackedPostpones, task, segment) {
		segment.status = 5;
		var keyPath = task.keyPath, boundary = task.blockedBoundary;
		if (null === boundary) segment.id = request.nextSegmentId++, trackedPostpones.rootSlots = segment.id, null !== request.completedRootSegment && (request.completedRootSegment.status = 5);
		else {
			if (null !== boundary && 0 === boundary.status) {
				var boundaryNode = trackPostponedBoundary(request, trackedPostpones, boundary);
				if (null !== boundary.tracked && boundary.tracked.contentKeyPath === keyPath && -1 === task.childIndex) {
					-1 === segment.id && (segment.id = segment.parentFlushed ? boundary.rootSegmentID : request.nextSegmentId++);
					boundaryNode[3] = segment.id;
					return;
				}
			}
			-1 === segment.id && (segment.id = segment.parentFlushed && null !== boundary ? boundary.rootSegmentID : request.nextSegmentId++);
			if (-1 === task.childIndex) null === keyPath ? trackedPostpones.rootSlots = segment.id : (task = trackedPostpones.workingMap.get(keyPath), void 0 === task ? (task = [
				keyPath[1],
				keyPath[2],
				[],
				segment.id
			], addToReplayParent(task, keyPath[0], trackedPostpones)) : task[3] = segment.id);
			else {
				if (null === keyPath) {
					if (request = trackedPostpones.rootSlots, null === request) request = trackedPostpones.rootSlots = {};
					else if ("number" === typeof request) throw Error("It should not be possible to postpone both at the root of an element as well as a slot below. This is a bug in React.");
				} else if (boundary = trackedPostpones.workingMap, boundaryNode = boundary.get(keyPath), void 0 === boundaryNode) request = {}, boundaryNode = [
					keyPath[1],
					keyPath[2],
					[],
					request
				], boundary.set(keyPath, boundaryNode), addToReplayParent(boundaryNode, keyPath[0], trackedPostpones);
				else if (request = boundaryNode[3], null === request) request = boundaryNode[3] = {};
				else if ("number" === typeof request) throw Error("It should not be possible to postpone both at the root of an element as well as a slot below. This is a bug in React.");
				request[task.childIndex] = segment.id;
			}
		}
	}
	function untrackBoundary(request, boundary) {
		request = request.trackedPostpones;
		null !== request && (boundary = boundary.tracked, null !== boundary && (boundary = boundary.contentKeyPath, null !== boundary && (request = request.workingMap.get(boundary), void 0 !== request && (request.length = 4, request[2] = [], request[3] = null))));
	}
	function spawnNewSuspendedReplayTask(request, task, thenableState) {
		return createReplayTask(request, thenableState, task.replay, task.node, task.childIndex, task.blockedBoundary, task.hoistableState, task.abortSet, task.keyPath, task.formatContext, task.context, task.treeContext, task.row, task.componentStack);
	}
	function spawnNewSuspendedRenderTask(request, task, thenableState) {
		var segment = task.blockedSegment, newSegment = createPendingSegment(request, segment.chunks.length, null, task.formatContext, segment.lastPushedText, !0);
		segment.children.push(newSegment);
		segment.lastPushedText = !1;
		return createRenderTask(request, thenableState, task.node, task.childIndex, task.blockedBoundary, newSegment, task.blockedPreamble, task.hoistableState, task.abortSet, task.keyPath, task.formatContext, task.context, task.treeContext, task.row, task.componentStack);
	}
	function renderNode(request, task, node, childIndex) {
		var previousFormatContext = task.formatContext, previousContext = task.context, previousKeyPath = task.keyPath, previousTreeContext = task.treeContext, previousComponentStack = task.componentStack, segment = task.blockedSegment;
		if (null === segment) {
			segment = task.replay;
			try {
				return renderNodeDestructive(request, task, node, childIndex);
			} catch (thrownValue) {
				if (resetHooksState(), node = thrownValue === SuspenseException ? getSuspendedThenable() : thrownValue, !request.aborted && "object" === typeof node && null !== node) {
					if ("function" === typeof node.then) {
						childIndex = thrownValue === SuspenseException ? getThenableStateAfterSuspending() : null;
						request = spawnNewSuspendedReplayTask(request, task, childIndex).ping;
						node.then(request.resolve, request.reject);
						task.formatContext = previousFormatContext;
						task.context = previousContext;
						task.keyPath = previousKeyPath;
						task.treeContext = previousTreeContext;
						task.componentStack = previousComponentStack;
						task.replay = segment;
						switchContext(previousContext);
						return;
					}
					if ("Maximum call stack size exceeded" === node.message) {
						node = thrownValue === SuspenseException ? getThenableStateAfterSuspending() : null;
						node = spawnNewSuspendedReplayTask(request, task, node);
						request.pingedTasks.push(node);
						task.formatContext = previousFormatContext;
						task.context = previousContext;
						task.keyPath = previousKeyPath;
						task.treeContext = previousTreeContext;
						task.componentStack = previousComponentStack;
						task.replay = segment;
						switchContext(previousContext);
						return;
					}
				}
			}
		} else {
			var childrenLength = segment.children.length, chunkLength = segment.chunks.length;
			try {
				return renderNodeDestructive(request, task, node, childIndex);
			} catch (thrownValue$63) {
				if (resetHooksState(), segment.children.length = childrenLength, segment.chunks.length = chunkLength, node = thrownValue$63 === SuspenseException ? getSuspendedThenable() : thrownValue$63, !request.aborted && "object" === typeof node && null !== node) {
					if ("function" === typeof node.then) {
						segment = node;
						node = thrownValue$63 === SuspenseException ? getThenableStateAfterSuspending() : null;
						request = spawnNewSuspendedRenderTask(request, task, node).ping;
						segment.then(request.resolve, request.reject);
						task.formatContext = previousFormatContext;
						task.context = previousContext;
						task.keyPath = previousKeyPath;
						task.treeContext = previousTreeContext;
						task.componentStack = previousComponentStack;
						switchContext(previousContext);
						return;
					}
					if ("Maximum call stack size exceeded" === node.message) {
						segment = thrownValue$63 === SuspenseException ? getThenableStateAfterSuspending() : null;
						segment = spawnNewSuspendedRenderTask(request, task, segment);
						request.pingedTasks.push(segment);
						task.formatContext = previousFormatContext;
						task.context = previousContext;
						task.keyPath = previousKeyPath;
						task.treeContext = previousTreeContext;
						task.componentStack = previousComponentStack;
						switchContext(previousContext);
						return;
					}
				}
			}
		}
		task.formatContext = previousFormatContext;
		task.context = previousContext;
		task.keyPath = previousKeyPath;
		task.treeContext = previousTreeContext;
		switchContext(previousContext);
		throw node;
	}
	function abortTaskSoft(task) {
		var boundary = task.blockedBoundary, segment = task.blockedSegment;
		null !== segment && (segment.status = 3, finishedTask(this, boundary, task.row, segment));
	}
	function abortRemainingReplayNodes(request$jscomp$0, boundary, nodes, slots, error, errorDigest$jscomp$0) {
		for (var i = 0; i < nodes.length; i++) {
			var node = nodes[i];
			if (4 === node.length) abortRemainingReplayNodes(request$jscomp$0, boundary, node[2], node[3], error, errorDigest$jscomp$0);
			else {
				node = node[5];
				var request = request$jscomp$0, errorDigest = errorDigest$jscomp$0, resumedBoundary = createSuspenseBoundary(request, null, /* @__PURE__ */ new Set(), null, !1);
				resumedBoundary.parentFlushed = !0;
				resumedBoundary.rootSegmentID = node;
				resumedBoundary.status = 4;
				resumedBoundary.errorDigest = errorDigest;
				resumedBoundary.parentFlushed && request.clientRenderedBoundaries.push(resumedBoundary);
			}
		}
		nodes.length = 0;
		if (null !== slots) {
			if (null === boundary) throw Error("We should not have any resumable nodes in the shell. This is a bug in React.");
			4 !== boundary.status && (boundary.status = 4, boundary.errorDigest = errorDigest$jscomp$0, boundary.parentFlushed && request$jscomp$0.clientRenderedBoundaries.push(boundary));
			if ("object" === typeof slots) for (var index in slots) delete slots[index];
		}
	}
	function abortTask(task, request) {
		if (task !== request.currentTask) {
			var boundary = task.blockedBoundary;
			task = task.blockedSegment;
			null !== task && (task.status = 3);
			null !== boundary && boundary.fallbackAbortableTasks.forEach(function(fallbackTask) {
				return abortTask(fallbackTask, request);
			});
		}
	}
	function finishAbortedTask(task, request, error) {
		if (task !== request.currentTask) {
			var boundary = task.blockedBoundary, segment = task.blockedSegment;
			if (null === segment || 3 === segment.status) {
				var errorInfo = getThrownInfo(task.componentStack), isRecoverableReason = isRecoverableError(error);
				if (null === boundary) {
					boundary = task.replay;
					if (null === boundary) {
						isRecoverableReason || null === request.trackedPostpones || null === segment ? isRecoverableReason ? (task = cloneRecoverableErrorAsFatal(error), logRecoverableError(request, task, errorInfo), 12 !== request.status && 13 !== request.status && fatalError(request, task)) : (logRecoverableError(request, error, errorInfo), 12 !== request.status && 13 !== request.status && fatalError(request, error)) : (boundary = request.trackedPostpones, logRecoverableError(request, error, errorInfo), trackPostpone(request, boundary, task, segment), finishedTask(request, null, task.row, segment));
						return;
					}
					12 !== request.status && 13 !== request.status && (boundary.pendingTasks--, 0 === boundary.pendingTasks && 0 < boundary.nodes.length && (errorInfo = logRecoverableError(request, error, errorInfo), abortRemainingReplayNodes(request, null, boundary.nodes, boundary.slots, error, errorInfo)), request.pendingRootTasks--, 0 === request.pendingRootTasks && completeShell(request));
				} else {
					var trackedPostpones$64 = request.trackedPostpones;
					if (4 !== boundary.status) {
						if (!isRecoverableReason && null !== trackedPostpones$64 && null !== segment) return logRecoverableError(request, error, errorInfo), trackPostpone(request, trackedPostpones$64, task, segment), boundary.fallbackAbortableTasks.forEach(function(fallbackTask) {
							return finishAbortedTask(fallbackTask, request, error);
						}), boundary.fallbackAbortableTasks.clear(), finishedTask(request, boundary, task.row, segment);
						boundary.status = 4;
						errorInfo = logRecoverableError(request, error, errorInfo);
						boundary.errorDigest = errorInfo;
						untrackBoundary(request, boundary);
						boundary.parentFlushed && request.clientRenderedBoundaries.push(boundary);
					}
					boundary.pendingTasks--;
					errorInfo = boundary.row;
					null !== errorInfo && 0 === --errorInfo.pendingTasks && finishSuspenseListRow(request, errorInfo);
					boundary.fallbackAbortableTasks.forEach(function(fallbackTask) {
						return finishAbortedTask(fallbackTask, request, error);
					});
					boundary.fallbackAbortableTasks.clear();
				}
				task = task.row;
				null !== task && 0 === --task.pendingTasks && finishSuspenseListRow(request, task);
				request.allPendingTasks--;
				0 === request.allPendingTasks && completeAll(request);
			}
		}
	}
	function safelyEmitEarlyPreloads(request, shellComplete) {
		try {
			var renderState = request.renderState, onHeaders = renderState.onHeaders;
			if (onHeaders) {
				var headers = renderState.headers;
				if (headers) {
					renderState.headers = null;
					var linkHeader = headers.preconnects;
					headers.fontPreloads && (linkHeader && (linkHeader += ", "), linkHeader += headers.fontPreloads);
					headers.highImagePreloads && (linkHeader && (linkHeader += ", "), linkHeader += headers.highImagePreloads);
					if (!shellComplete) {
						var queueIter = renderState.styles.values(), queueStep = queueIter.next();
						b: for (; 0 < headers.remainingCapacity && !queueStep.done; queueStep = queueIter.next()) for (var sheetIter = queueStep.value.sheets.values(), sheetStep = sheetIter.next(); 0 < headers.remainingCapacity && !sheetStep.done; sheetStep = sheetIter.next()) {
							var sheet = sheetStep.value, props = sheet.props, key = props.href, props$jscomp$0 = sheet.props, header = getPreloadAsHeader(props$jscomp$0.href, "style", {
								crossOrigin: props$jscomp$0.crossOrigin,
								integrity: props$jscomp$0.integrity,
								nonce: props$jscomp$0.nonce,
								type: props$jscomp$0.type,
								fetchPriority: props$jscomp$0.fetchPriority,
								referrerPolicy: props$jscomp$0.referrerPolicy,
								media: props$jscomp$0.media
							});
							if (0 <= (headers.remainingCapacity -= header.length + 2)) renderState.resets.style[key] = PRELOAD_NO_CREDS, linkHeader && (linkHeader += ", "), linkHeader += header, renderState.resets.style[key] = "string" === typeof props.crossOrigin || "string" === typeof props.integrity ? [props.crossOrigin, props.integrity] : PRELOAD_NO_CREDS;
							else break b;
						}
					}
					linkHeader ? onHeaders({ Link: linkHeader }) : onHeaders({});
				}
			}
		} catch (error) {
			logRecoverableError(request, error, {});
		}
	}
	function completeShell(request) {
		null === request.trackedPostpones && safelyEmitEarlyPreloads(request, !0);
		null === request.trackedPostpones && preparePreamble(request);
		request = request.onShellReady;
		request();
	}
	function completeAll(request) {
		safelyEmitEarlyPreloads(request, null === request.trackedPostpones ? !0 : null === request.completedRootSegment || 5 !== request.completedRootSegment.status);
		preparePreamble(request);
		request = request.onAllReady;
		request();
	}
	function queueCompletedSegment(boundary, segment) {
		if (0 === segment.chunks.length && 1 === segment.children.length && null === segment.children[0].boundary && -1 === segment.children[0].id) {
			var childSegment = segment.children[0];
			childSegment.id = segment.id;
			childSegment.parentFlushed = !0;
			1 !== childSegment.status && 3 !== childSegment.status && 4 !== childSegment.status || queueCompletedSegment(boundary, childSegment);
		} else boundary.completedSegments.push(segment);
	}
	function finishedTask(request, boundary, row, segment) {
		null !== row && (0 === --row.pendingTasks ? finishSuspenseListRow(request, row) : row.together && tryToResolveTogetherRow(request, row));
		request.allPendingTasks--;
		if (null === boundary) {
			if (null !== segment && segment.parentFlushed) {
				if (null !== request.completedRootSegment) throw Error("There can only be one root segment. This is a bug in React.");
				request.completedRootSegment = segment;
			}
			request.pendingRootTasks--;
			0 === request.pendingRootTasks && completeShell(request);
		} else if (boundary.pendingTasks--, 4 !== boundary.status) if (0 === boundary.pendingTasks) {
			if (0 === boundary.status && (boundary.status = 1), null !== segment && segment.parentFlushed && (1 === segment.status || 3 === segment.status) && queueCompletedSegment(boundary, segment), boundary.parentFlushed && request.completedBoundaries.push(boundary), 1 === boundary.status) row = boundary.row, null !== row && hoistHoistables(row.hoistables, boundary.contentState), isEligibleForOutlining(request, boundary) || (request.allPendingTasks++, boundary.fallbackAbortableTasks.forEach(abortTaskSoft, request), boundary.fallbackAbortableTasks.clear(), null !== row && 0 === --row.pendingTasks && finishSuspenseListRow(request, row), request.allPendingTasks--), 0 === request.pendingRootTasks && null === request.trackedPostpones && null !== boundary.preamble && preparePreamble(request);
			else if (5 === boundary.status && (boundary = boundary.row, null !== boundary)) {
				if (null !== request.trackedPostpones) {
					row = request.trackedPostpones;
					var postponedRow = boundary.next;
					if (null !== postponedRow && (segment = postponedRow.boundaries, null !== segment)) for (postponedRow.boundaries = null, postponedRow = 0; postponedRow < segment.length; postponedRow++) {
						var postponedBoundary = segment[postponedRow];
						trackPostponedBoundary(request, row, postponedBoundary);
						finishedTask(request, postponedBoundary, null, null);
					}
				}
				request.allPendingTasks++;
				0 === --boundary.pendingTasks && finishSuspenseListRow(request, boundary);
				request.allPendingTasks--;
			}
		} else null === segment || !segment.parentFlushed || 1 !== segment.status && 3 !== segment.status || (queueCompletedSegment(boundary, segment), 1 === boundary.completedSegments.length && boundary.parentFlushed && request.partialBoundaries.push(boundary)), boundary = boundary.row, null !== boundary && boundary.together && tryToResolveTogetherRow(request, boundary);
		0 === request.allPendingTasks && completeAll(request);
	}
	function performWork(request$jscomp$1) {
		if (!(request$jscomp$1.aborted || 11 < request$jscomp$1.status)) {
			var prevContext = currentActiveSnapshot, prevDispatcher = ReactSharedInternals.H;
			ReactSharedInternals.H = HooksDispatcher;
			var prevAsyncDispatcher = ReactSharedInternals.A;
			ReactSharedInternals.A = DefaultAsyncDispatcher;
			var prevRequest = currentRequest;
			currentRequest = request$jscomp$1;
			var prevResumableState = currentResumableState;
			currentResumableState = request$jscomp$1.resumableState;
			try {
				var pingedTasks = request$jscomp$1.pingedTasks, i = 0;
				for (; i < pingedTasks.length; i++) {
					var task = pingedTasks[i], request = request$jscomp$1, segment = task.blockedSegment;
					if (null === segment) {
						a: if (0 !== task.replay.pendingTasks) {
							var prevTask = request.currentTask;
							request.currentTask = task;
							switchContext(task.context);
							var startNode = task.node;
							try {
								"number" === typeof task.replay.slots ? resumeNode(request, task, task.replay.slots, task.node, task.childIndex) : retryNode(request, task);
								if (1 === task.replay.pendingTasks && 0 < task.replay.nodes.length) throw Error("Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering.");
								task.replay.pendingTasks--;
								task.abortSet.delete(task);
								finishedTask(request, task.blockedBoundary, task.row, null);
							} catch (thrownValue) {
								resetHooksState();
								var x = thrownValue === SuspenseException ? getSuspendedThenable() : thrownValue;
								if (request.aborted) {
									thrownValue === SuspenseException && (task.thenableState = getThenableStateAfterSuspending());
									request.currentTask = prevTask;
									var request$jscomp$0 = request;
									abortTask(task, request$jscomp$0);
									task.abortSet.delete(task);
									finishAbortedTask(task, request$jscomp$0, request$jscomp$0.fatalError);
								} else {
									if ("object" === typeof x && null !== x) {
										if ("function" === typeof x.then) {
											var ping = task.ping;
											x.then(ping.resolve, ping.reject);
											task.thenableState = thrownValue === SuspenseException ? getThenableStateAfterSuspending() : null;
											break a;
										}
										if ("Maximum call stack size exceeded" === x.message && task.node !== startNode) {
											task.thenableState = null;
											request.pingedTasks.push(task);
											break a;
										}
									}
									task.replay.pendingTasks--;
									task.abortSet.delete(task);
									var errorInfo = getThrownInfo(task.componentStack);
									request$jscomp$0 = request;
									var boundary = task.blockedBoundary, error$jscomp$0 = request.aborted ? request.fatalError : x, replayNodes = task.replay.nodes, resumeSlots = task.replay.slots, errorDigest = logRecoverableError(request$jscomp$0, error$jscomp$0, errorInfo);
									abortRemainingReplayNodes(request$jscomp$0, boundary, replayNodes, resumeSlots, error$jscomp$0, errorDigest);
									request.pendingRootTasks--;
									0 === request.pendingRootTasks && completeShell(request);
									request.allPendingTasks--;
									0 === request.allPendingTasks && completeAll(request);
								}
							} finally {
								request.currentTask = prevTask;
							}
						}
					} else a: if (request$jscomp$0 = segment, 0 === request$jscomp$0.status) {
						var prevTask$jscomp$0 = request.currentTask;
						request.currentTask = task;
						switchContext(task.context);
						var childrenLength = request$jscomp$0.children.length, chunkLength = request$jscomp$0.chunks.length, startNode$jscomp$0 = task.node;
						try {
							retryNode(request, task), pushSegmentFinale(request$jscomp$0.chunks, request.renderState, request$jscomp$0.lastPushedText, request$jscomp$0.textEmbedded), task.abortSet.delete(task), request$jscomp$0.status = 1, finishedTask(request, task.blockedBoundary, task.row, request$jscomp$0);
						} catch (thrownValue) {
							resetHooksState();
							request$jscomp$0.children.length = childrenLength;
							request$jscomp$0.chunks.length = chunkLength;
							var x$jscomp$0 = thrownValue === SuspenseException ? getSuspendedThenable() : thrownValue;
							if (request.aborted) thrownValue === SuspenseException && (task.thenableState = getThenableStateAfterSuspending()), request.currentTask = prevTask$jscomp$0, request$jscomp$0 = request, abortTask(task, request$jscomp$0), task.abortSet.delete(task), finishAbortedTask(task, request$jscomp$0, request$jscomp$0.fatalError);
							else {
								if ("object" === typeof x$jscomp$0 && null !== x$jscomp$0) {
									if ("function" === typeof x$jscomp$0.then) {
										request$jscomp$0.status = 0;
										task.thenableState = thrownValue === SuspenseException ? getThenableStateAfterSuspending() : null;
										var ping$jscomp$0 = task.ping;
										x$jscomp$0.then(ping$jscomp$0.resolve, ping$jscomp$0.reject);
										break a;
									}
									if ("Maximum call stack size exceeded" === x$jscomp$0.message && task.node !== startNode$jscomp$0) {
										request$jscomp$0.status = 0;
										task.thenableState = null;
										request.pingedTasks.push(task);
										break a;
									}
								}
								var errorInfo$jscomp$0 = getThrownInfo(task.componentStack);
								task.abortSet.delete(task);
								request$jscomp$0.status = 4;
								var boundary$jscomp$0 = task.blockedBoundary, row = task.row;
								null !== row && 0 === --row.pendingTasks && finishSuspenseListRow(request, row);
								request.allPendingTasks--;
								if (null === boundary$jscomp$0) if (isRecoverableError(x$jscomp$0)) {
									var fatalRecoverableError = cloneRecoverableErrorAsFatal(x$jscomp$0);
									logRecoverableError(request, fatalRecoverableError, errorInfo$jscomp$0);
									fatalError(request, fatalRecoverableError);
								} else logRecoverableError(request, x$jscomp$0, errorInfo$jscomp$0), fatalError(request, x$jscomp$0);
								else {
									var errorDigest$jscomp$0 = logRecoverableError(request, x$jscomp$0, errorInfo$jscomp$0);
									boundary$jscomp$0.pendingTasks--;
									if (4 !== boundary$jscomp$0.status) {
										boundary$jscomp$0.status = 4;
										boundary$jscomp$0.errorDigest = errorDigest$jscomp$0;
										untrackBoundary(request, boundary$jscomp$0);
										var boundaryRow = boundary$jscomp$0.row;
										null !== boundaryRow && (request.allPendingTasks++, 0 === --boundaryRow.pendingTasks && finishSuspenseListRow(request, boundaryRow), request.allPendingTasks--);
										boundary$jscomp$0.parentFlushed && request.clientRenderedBoundaries.push(boundary$jscomp$0);
										0 === request.pendingRootTasks && null === request.trackedPostpones && null !== boundary$jscomp$0.preamble && preparePreamble(request);
									}
									0 === request.allPendingTasks && completeAll(request);
								}
							}
						} finally {
							request.currentTask = prevTask$jscomp$0;
						}
					}
				}
				pingedTasks.splice(0, i);
				null !== request$jscomp$1.destination && flushCompletedQueues(request$jscomp$1, request$jscomp$1.destination);
			} catch (error) {
				logRecoverableError(request$jscomp$1, error, {}), fatalError(request$jscomp$1, error);
			} finally {
				currentResumableState = prevResumableState, ReactSharedInternals.H = prevDispatcher, ReactSharedInternals.A = prevAsyncDispatcher, prevDispatcher === HooksDispatcher && switchContext(prevContext), currentRequest = prevRequest;
			}
		}
	}
	function preparePreambleFromSubtree(request, segment, collectedPreambleSegments) {
		segment.preambleChildren.length && collectedPreambleSegments.push(segment.preambleChildren);
		for (var pendingPreambles = !1, i = 0; i < segment.children.length; i++) pendingPreambles = preparePreambleFromSegment(request, segment.children[i], collectedPreambleSegments) || pendingPreambles;
		return pendingPreambles;
	}
	function preparePreambleFromSegment(request, segment, collectedPreambleSegments) {
		var boundary = segment.boundary;
		if (null === boundary) return preparePreambleFromSubtree(request, segment, collectedPreambleSegments);
		var preamble = boundary.preamble;
		if (null === preamble) return !1;
		switch (boundary.status) {
			case 1:
				hoistPreambleState(request.renderState, preamble.content);
				request.byteSize += boundary.byteSize;
				segment = boundary.completedSegments[0];
				if (!segment) throw Error("A previously unvisited boundary must have exactly one root segment. This is a bug in React.");
				return preparePreambleFromSubtree(request, segment, collectedPreambleSegments);
			case 5: if (null !== request.trackedPostpones) return !0;
			case 4: if (1 === segment.status) return hoistPreambleState(request.renderState, preamble.fallback), preparePreambleFromSubtree(request, segment, collectedPreambleSegments);
			default: return !0;
		}
	}
	function preparePreamble(request) {
		if (request.completedRootSegment && null === request.completedPreambleSegments) {
			var collectedPreambleSegments = [], originalRequestByteSize = request.byteSize, hasPendingPreambles = preparePreambleFromSegment(request, request.completedRootSegment, collectedPreambleSegments), preamble = request.renderState.preamble;
			!1 === hasPendingPreambles || preamble.headChunks && preamble.bodyChunks ? request.completedPreambleSegments = collectedPreambleSegments : request.byteSize = originalRequestByteSize;
		}
	}
	function flushSubtree(request, destination, segment, hoistableState) {
		segment.parentFlushed = !0;
		switch (segment.status) {
			case 0: segment.id = request.nextSegmentId++;
			case 5: return hoistableState = segment.id, segment.lastPushedText = !1, segment.textEmbedded = !1, request = request.renderState, destination.push("<template id=\""), destination.push(request.placeholderPrefix), request = hoistableState.toString(16), destination.push(request), destination.push("\"></template>");
			case 1:
				segment.status = 2;
				var r = !0, chunks = segment.chunks, chunkIdx = 0;
				segment = segment.children;
				for (var childIdx = 0; childIdx < segment.length; childIdx++) {
					for (r = segment[childIdx]; chunkIdx < r.index; chunkIdx++) destination.push(chunks[chunkIdx]);
					r = flushSegment(request, destination, r, hoistableState);
				}
				for (; chunkIdx < chunks.length - 1; chunkIdx++) destination.push(chunks[chunkIdx]);
				chunkIdx < chunks.length && (r = destination.push(chunks[chunkIdx]));
				return r;
			case 3: return !0;
			default: throw Error("Aborted, errored or already flushed boundaries should not be flushed again. This is a bug in React.");
		}
	}
	var flushedByteSize = 0;
	function flushSegment(request, destination, segment, hoistableState) {
		var boundary = segment.boundary;
		if (null === boundary) return flushSubtree(request, destination, segment, hoistableState);
		segment.boundary = null;
		boundary.parentFlushed = !0;
		if (4 === boundary.status) {
			var row = boundary.row;
			null !== row && 0 === --row.pendingTasks && finishSuspenseListRow(request, row);
			request.renderState.generateStaticMarkup || (boundary = boundary.errorDigest, destination.push("<!--$!-->"), destination.push("<template"), null != boundary && (destination.push(" data-dgst=\""), boundary = escapeTextForBrowser(boundary), destination.push(boundary), destination.push("\"")), destination.push("></template>"));
			flushSubtree(request, destination, segment, hoistableState);
			request = request.renderState.generateStaticMarkup ? !0 : destination.push("<!--/$-->");
			return request;
		}
		if (1 !== boundary.status) return 0 === boundary.status && (boundary.rootSegmentID = request.nextSegmentId++), 0 < boundary.completedSegments.length && request.partialBoundaries.push(boundary), writeStartPendingSuspenseBoundary(destination, request.renderState, boundary.rootSegmentID), hoistableState && hoistHoistables(hoistableState, boundary.fallbackState), flushSubtree(request, destination, segment, hoistableState), destination.push("<!--/$-->");
		if (!flushingPartialBoundaries && isEligibleForOutlining(request, boundary) && (flushedByteSize + boundary.byteSize > request.progressiveChunkSize || boundary.defer)) return boundary.rootSegmentID = request.nextSegmentId++, request.completedBoundaries.push(boundary), writeStartPendingSuspenseBoundary(destination, request.renderState, boundary.rootSegmentID), flushSubtree(request, destination, segment, hoistableState), destination.push("<!--/$-->");
		flushedByteSize += boundary.byteSize;
		hoistableState && hoistHoistables(hoistableState, boundary.contentState);
		segment = boundary.row;
		null !== segment && isEligibleForOutlining(request, boundary) && 0 === --segment.pendingTasks && finishSuspenseListRow(request, segment);
		request.renderState.generateStaticMarkup || destination.push("<!--$-->");
		segment = boundary.completedSegments;
		if (1 !== segment.length) throw Error("A previously unvisited boundary must have exactly one root segment. This is a bug in React.");
		flushSegment(request, destination, segment[0], hoistableState);
		request = request.renderState.generateStaticMarkup ? !0 : destination.push("<!--/$-->");
		return request;
	}
	function flushSegmentContainer(request, destination, segment, hoistableState) {
		writeStartSegment(destination, request.renderState, segment.parentFormatContext, segment.id);
		flushSegment(request, destination, segment, hoistableState);
		return writeEndSegment(destination, segment.parentFormatContext);
	}
	function flushCompletedBoundary(request, destination, boundary) {
		flushedByteSize = boundary.byteSize;
		for (var completedSegments = boundary.completedSegments, i = 0; i < completedSegments.length; i++) flushPartiallyCompletedSegment(request, destination, boundary, completedSegments[i]);
		completedSegments.length = 0;
		completedSegments = boundary.row;
		null !== completedSegments && isEligibleForOutlining(request, boundary) && 0 === --completedSegments.pendingTasks && finishSuspenseListRow(request, completedSegments);
		writeHoistablesForBoundary(destination, boundary.contentState, request.renderState);
		completedSegments = request.resumableState;
		request = request.renderState;
		i = boundary.rootSegmentID;
		boundary = boundary.contentState;
		var requiresStyleInsertion = request.stylesToHoist, requiresViewTransitions = 0 !== (completedSegments.instructions & 128);
		request.stylesToHoist = !1;
		destination.push(request.startInlineScript);
		destination.push(">");
		requiresStyleInsertion ? (0 === (completedSegments.instructions & 4) && (completedSegments.instructions |= 4, destination.push("$RX=function(b,c,d,e,f){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data=\"$!\",a=a.dataset,null!=c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),f&&(a.cstck=f),b._reactRetry&&b._reactRetry())};")), 0 === (completedSegments.instructions & 2) && (completedSegments.instructions |= 2, destination.push("$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){var c=a[b],e=a[b+1];null!==e.parentNode&&e.parentNode.removeChild(e);var f=c.parentNode;if(f){var g=c.previousSibling,h=0;do{if(c&&8===c.nodeType){var d=c.data;if(\"/$\"===d||\"/&\"===d)if(0===h)break;else h--;else\"$\"!==d&&\"$?\"!==d&&\"$~\"!==d&&\"$!\"!==d&&\"&\"!==d||h++}d=c.nextSibling;f.removeChild(c);c=d}while(c);for(;e.firstChild;)f.insertBefore(e.firstChild,c);g.data=\"$\";g._reactRetry&&requestAnimationFrame(g._reactRetry)}}a.length=0};\n$RC=function(a,b){if(b=document.getElementById(b))(a=document.getElementById(a))?(a.previousSibling.data=\"$~\",$RB.push(a,b),2===$RB.length&&(\"number\"!==typeof $RT?requestAnimationFrame($RV.bind(null,$RB)):(a=performance.now(),setTimeout($RV.bind(null,$RB),2300>a&&2E3<a?2300-a:$RT+300-a)))):b.parentNode.removeChild(b)};")), requiresViewTransitions && 0 === (completedSegments.instructions & 256) && (completedSegments.instructions |= 256, destination.push("$RV=function(B,g){function h(a,c){var e=a.getAttribute(c);e&&(c=a.style,l.push(a,c.viewTransitionName,c.viewTransitionClass),\"auto\"!==e&&(c.viewTransitionClass=e),(a=a.getAttribute(\"vt-name\"))||(a=\"_T_\"+N++ +\"_\"),a=CSS.escape(a)!==a?\"r-\"+btoa(a).replace(/=/g,\"\"):a,c.viewTransitionName=a,C=!0)}var C=!1,N=0,l=[];try{var f=document.__reactViewTransition;if(f){f.finished.finally($RV.bind(null,g));return}var m=new Map;for(f=1;f<g.length;f+=2)for(var k=g[f].querySelectorAll(\"[vt-share]\"),d=0;d<k.length;d++){var b=k[d];m.set(b.getAttribute(\"vt-name\"),b)}var u=[];for(k=0;k<g.length;k+=2){var D=g[k],x=D.parentNode;if(x){var v=x.getBoundingClientRect();if(v.left||v.top||v.width||v.height){b=D;for(f=0;b;){if(8===b.nodeType){var t=b.data;if(\"/$\"===t)if(0===f)break;else f--;else\"$\"!==t&&\"$?\"!==t&&\"$~\"!==t&&\"$!\"!==t||f++}else if(1===b.nodeType){d=b;var E=d.getAttribute(\"vt-name\"),y=m.get(E);h(d,y?\"vt-share\":\"vt-exit\");y&&(h(y,\"vt-share\"),m.set(E,null));for(var F=d.querySelectorAll(\"[vt-share]\"),\nz=0;z<F.length;z++){var G=F[z],H=G.getAttribute(\"vt-name\"),I=m.get(H);I&&(h(G,\"vt-share\"),h(I,\"vt-share\"),m.set(H,null))}var J=d.querySelectorAll(\"[vt-parent-exit]\");for(d=0;d<J.length;d++)h(J[d],\"vt-parent-exit\")}b=b.nextSibling}for(var K=g[k+1],n=K.firstElementChild;n;){null!==m.get(n.getAttribute(\"vt-name\"))&&h(n,\"vt-enter\");var L=n.querySelectorAll(\"[vt-parent-enter]\");for(b=0;b<L.length;b++)h(L[b],\"vt-parent-enter\");n=n.nextElementSibling}b=x;do for(var p=b.firstElementChild;p;){var M=p.getAttribute(\"vt-update\");\nM&&\"none\"!==M&&!l.includes(p)&&h(p,\"vt-update\");p=p.nextElementSibling}while((b=b.parentNode)&&1===b.nodeType&&\"none\"!==b.getAttribute(\"vt-update\"));u.push.apply(u,K.querySelectorAll('img[src]:not([loading=\"lazy\"])'))}}}if(C){var A=document.__reactViewTransition=document.startViewTransition({update:function(){B(g);for(var a=[document.documentElement.clientHeight,document.fonts.ready],c={},e=0;e<u.length;c={g:c.g},e++)if(c.g=u[e],!c.g.complete){var q=c.g.getBoundingClientRect();0<q.bottom&&0<q.right&&\nq.top<window.innerHeight&&q.left<window.innerWidth&&(q=new Promise(function(w){return function(r){w.g.addEventListener(\"load\",r);w.g.addEventListener(\"error\",r)}}(c)),a.push(q))}return Promise.race([Promise.all(a),new Promise(function(w){var r=performance.now();setTimeout(w,2300>r&&2E3<r?2300-r:500)})])},types:[]});A.ready.finally(function(){for(var a=l.length-3;0<=a;a-=3){var c=l[a],e=c.style;e.viewTransitionName=l[a+1];e.viewTransitionClass=l[a+1];\"\"===c.getAttribute(\"style\")&&c.removeAttribute(\"style\")}});\nA.finished.finally(function(){document.__reactViewTransition===A&&(document.__reactViewTransition=null)});$RB=[];return}}catch(a){}B(g)}.bind(null,$RV);")), 0 === (completedSegments.instructions & 8) ? (completedSegments.instructions |= 8, destination.push("$RM=new Map;$RR=function(n,w,p){function u(q){this._p=null;q()}for(var r=new Map,t=document,h,b,e=t.querySelectorAll(\"link[data-precedence],style[data-precedence]\"),v=[],k=0;b=e[k++];)\"not all\"===b.getAttribute(\"media\")?v.push(b):(\"LINK\"===b.tagName&&$RM.set(b.getAttribute(\"href\"),b),r.set(b.dataset.precedence,h=b));e=0;b=[];var l,a;for(k=!0;;){if(k){var f=p[e++];if(!f){k=!1;e=0;continue}var c=!1,m=0;var d=f[m++];if(a=$RM.get(d)){var g=a._p;c=!0}else{a=t.createElement(\"link\");a.href=d;a.rel=\n\"stylesheet\";for(a.dataset.precedence=l=f[m++];g=f[m++];)a.setAttribute(g,f[m++]);g=a._p=new Promise(function(q,x){a.onload=u.bind(a,q);a.onerror=u.bind(a,x)});$RM.set(d,a)}d=a.getAttribute(\"media\");!g||d&&!matchMedia(d).matches||b.push(g);if(c)continue}else{a=v[e++];if(!a)break;l=a.getAttribute(\"data-precedence\");a.removeAttribute(\"media\")}c=r.get(l)||h;c===h&&(h=a);r.set(l,a);c?c.parentNode.insertBefore(a,c.nextSibling):(c=t.head,c.insertBefore(a,c.firstChild))}if(p=document.getElementById(n))p.previousSibling.data=\n\"$~\";Promise.all(b).then($RC.bind(null,n,w),$RX.bind(null,n,\"CSS failed to load\"))};$RR(\"")) : destination.push("$RR(\"")) : (0 === (completedSegments.instructions & 2) && (completedSegments.instructions |= 2, destination.push("$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){var c=a[b],e=a[b+1];null!==e.parentNode&&e.parentNode.removeChild(e);var f=c.parentNode;if(f){var g=c.previousSibling,h=0;do{if(c&&8===c.nodeType){var d=c.data;if(\"/$\"===d||\"/&\"===d)if(0===h)break;else h--;else\"$\"!==d&&\"$?\"!==d&&\"$~\"!==d&&\"$!\"!==d&&\"&\"!==d||h++}d=c.nextSibling;f.removeChild(c);c=d}while(c);for(;e.firstChild;)f.insertBefore(e.firstChild,c);g.data=\"$\";g._reactRetry&&requestAnimationFrame(g._reactRetry)}}a.length=0};\n$RC=function(a,b){if(b=document.getElementById(b))(a=document.getElementById(a))?(a.previousSibling.data=\"$~\",$RB.push(a,b),2===$RB.length&&(\"number\"!==typeof $RT?requestAnimationFrame($RV.bind(null,$RB)):(a=performance.now(),setTimeout($RV.bind(null,$RB),2300>a&&2E3<a?2300-a:$RT+300-a)))):b.parentNode.removeChild(b)};")), requiresViewTransitions && 0 === (completedSegments.instructions & 256) && (completedSegments.instructions |= 256, destination.push("$RV=function(B,g){function h(a,c){var e=a.getAttribute(c);e&&(c=a.style,l.push(a,c.viewTransitionName,c.viewTransitionClass),\"auto\"!==e&&(c.viewTransitionClass=e),(a=a.getAttribute(\"vt-name\"))||(a=\"_T_\"+N++ +\"_\"),a=CSS.escape(a)!==a?\"r-\"+btoa(a).replace(/=/g,\"\"):a,c.viewTransitionName=a,C=!0)}var C=!1,N=0,l=[];try{var f=document.__reactViewTransition;if(f){f.finished.finally($RV.bind(null,g));return}var m=new Map;for(f=1;f<g.length;f+=2)for(var k=g[f].querySelectorAll(\"[vt-share]\"),d=0;d<k.length;d++){var b=k[d];m.set(b.getAttribute(\"vt-name\"),b)}var u=[];for(k=0;k<g.length;k+=2){var D=g[k],x=D.parentNode;if(x){var v=x.getBoundingClientRect();if(v.left||v.top||v.width||v.height){b=D;for(f=0;b;){if(8===b.nodeType){var t=b.data;if(\"/$\"===t)if(0===f)break;else f--;else\"$\"!==t&&\"$?\"!==t&&\"$~\"!==t&&\"$!\"!==t||f++}else if(1===b.nodeType){d=b;var E=d.getAttribute(\"vt-name\"),y=m.get(E);h(d,y?\"vt-share\":\"vt-exit\");y&&(h(y,\"vt-share\"),m.set(E,null));for(var F=d.querySelectorAll(\"[vt-share]\"),\nz=0;z<F.length;z++){var G=F[z],H=G.getAttribute(\"vt-name\"),I=m.get(H);I&&(h(G,\"vt-share\"),h(I,\"vt-share\"),m.set(H,null))}var J=d.querySelectorAll(\"[vt-parent-exit]\");for(d=0;d<J.length;d++)h(J[d],\"vt-parent-exit\")}b=b.nextSibling}for(var K=g[k+1],n=K.firstElementChild;n;){null!==m.get(n.getAttribute(\"vt-name\"))&&h(n,\"vt-enter\");var L=n.querySelectorAll(\"[vt-parent-enter]\");for(b=0;b<L.length;b++)h(L[b],\"vt-parent-enter\");n=n.nextElementSibling}b=x;do for(var p=b.firstElementChild;p;){var M=p.getAttribute(\"vt-update\");\nM&&\"none\"!==M&&!l.includes(p)&&h(p,\"vt-update\");p=p.nextElementSibling}while((b=b.parentNode)&&1===b.nodeType&&\"none\"!==b.getAttribute(\"vt-update\"));u.push.apply(u,K.querySelectorAll('img[src]:not([loading=\"lazy\"])'))}}}if(C){var A=document.__reactViewTransition=document.startViewTransition({update:function(){B(g);for(var a=[document.documentElement.clientHeight,document.fonts.ready],c={},e=0;e<u.length;c={g:c.g},e++)if(c.g=u[e],!c.g.complete){var q=c.g.getBoundingClientRect();0<q.bottom&&0<q.right&&\nq.top<window.innerHeight&&q.left<window.innerWidth&&(q=new Promise(function(w){return function(r){w.g.addEventListener(\"load\",r);w.g.addEventListener(\"error\",r)}}(c)),a.push(q))}return Promise.race([Promise.all(a),new Promise(function(w){var r=performance.now();setTimeout(w,2300>r&&2E3<r?2300-r:500)})])},types:[]});A.ready.finally(function(){for(var a=l.length-3;0<=a;a-=3){var c=l[a],e=c.style;e.viewTransitionName=l[a+1];e.viewTransitionClass=l[a+1];\"\"===c.getAttribute(\"style\")&&c.removeAttribute(\"style\")}});\nA.finished.finally(function(){document.__reactViewTransition===A&&(document.__reactViewTransition=null)});$RB=[];return}}catch(a){}B(g)}.bind(null,$RV);")), destination.push("$RC(\""));
		completedSegments = i.toString(16);
		destination.push(request.boundaryPrefix);
		destination.push(completedSegments);
		destination.push("\",\"");
		destination.push(request.segmentPrefix);
		destination.push(completedSegments);
		requiresStyleInsertion ? (destination.push("\","), writeStyleResourceDependenciesInJS(destination, boundary)) : destination.push("\"");
		boundary = destination.push(")<\/script>");
		return writeBootstrap(destination, request) && boundary;
	}
	function flushPartiallyCompletedSegment(request, destination, boundary, segment) {
		if (2 === segment.status) return !0;
		var hoistableState = boundary.contentState, segmentID = segment.id;
		if (-1 === segmentID) {
			if (-1 === (segment.id = boundary.rootSegmentID)) throw Error("A root segment ID must have been assigned by now. This is a bug in React.");
			return flushSegmentContainer(request, destination, segment, hoistableState);
		}
		if (segmentID === boundary.rootSegmentID) return flushSegmentContainer(request, destination, segment, hoistableState);
		flushSegmentContainer(request, destination, segment, hoistableState);
		boundary = request.resumableState;
		request = request.renderState;
		destination.push(request.startInlineScript);
		destination.push(">");
		0 === (boundary.instructions & 1) ? (boundary.instructions |= 1, destination.push("$RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);b.parentNode.removeChild(b)};$RS(\"")) : destination.push("$RS(\"");
		destination.push(request.segmentPrefix);
		segmentID = segmentID.toString(16);
		destination.push(segmentID);
		destination.push("\",\"");
		destination.push(request.placeholderPrefix);
		destination.push(segmentID);
		destination = destination.push("\")<\/script>");
		return destination;
	}
	var flushingPartialBoundaries = !1;
	function flushCompletedQueues(request, destination) {
		try {
			if (!(0 < request.pendingRootTasks)) {
				var i, completedRootSegment = request.completedRootSegment;
				if (null !== completedRootSegment) {
					if (5 === completedRootSegment.status) return;
					var completedPreambleSegments = request.completedPreambleSegments;
					if (null === completedPreambleSegments) return;
					flushedByteSize = request.byteSize;
					var resumableState = request.resumableState, renderState = request.renderState, preamble = renderState.preamble, htmlChunks = preamble.htmlChunks, headChunks = preamble.headChunks, i$jscomp$0;
					if (htmlChunks) {
						for (i$jscomp$0 = 0; i$jscomp$0 < htmlChunks.length; i$jscomp$0++) destination.push(htmlChunks[i$jscomp$0]);
						if (headChunks) for (i$jscomp$0 = 0; i$jscomp$0 < headChunks.length; i$jscomp$0++) destination.push(headChunks[i$jscomp$0]);
						else {
							var chunk = startChunkForTag("head");
							destination.push(chunk);
							destination.push(">");
						}
					} else if (headChunks) for (i$jscomp$0 = 0; i$jscomp$0 < headChunks.length; i$jscomp$0++) destination.push(headChunks[i$jscomp$0]);
					var charsetChunks = renderState.charsetChunks;
					for (i$jscomp$0 = 0; i$jscomp$0 < charsetChunks.length; i$jscomp$0++) destination.push(charsetChunks[i$jscomp$0]);
					charsetChunks.length = 0;
					renderState.preconnects.forEach(flushResource, destination);
					renderState.preconnects.clear();
					var viewportChunks = renderState.viewportChunks;
					for (i$jscomp$0 = 0; i$jscomp$0 < viewportChunks.length; i$jscomp$0++) destination.push(viewportChunks[i$jscomp$0]);
					viewportChunks.length = 0;
					renderState.fontPreloads.forEach(flushResource, destination);
					renderState.fontPreloads.clear();
					renderState.highImagePreloads.forEach(flushResource, destination);
					renderState.highImagePreloads.clear();
					currentlyFlushingRenderState = renderState;
					renderState.styles.forEach(flushStylesInPreamble, destination);
					currentlyFlushingRenderState = null;
					var importMapChunks = renderState.importMapChunks;
					for (i$jscomp$0 = 0; i$jscomp$0 < importMapChunks.length; i$jscomp$0++) destination.push(importMapChunks[i$jscomp$0]);
					importMapChunks.length = 0;
					renderState.bootstrapScripts.forEach(flushResource, destination);
					renderState.scripts.forEach(flushResource, destination);
					renderState.scripts.clear();
					renderState.bulkPreloads.forEach(flushResource, destination);
					renderState.bulkPreloads.clear();
					resumableState.instructions |= 32;
					var hoistableChunks = renderState.hoistableChunks;
					for (i$jscomp$0 = 0; i$jscomp$0 < hoistableChunks.length; i$jscomp$0++) destination.push(hoistableChunks[i$jscomp$0]);
					for (resumableState = hoistableChunks.length = 0; resumableState < completedPreambleSegments.length; resumableState++) {
						var segments = completedPreambleSegments[resumableState];
						for (renderState = 0; renderState < segments.length; renderState++) flushSegment(request, destination, segments[renderState], null);
					}
					var preamble$jscomp$0 = request.renderState.preamble, headChunks$jscomp$0 = preamble$jscomp$0.headChunks;
					if (preamble$jscomp$0.htmlChunks || headChunks$jscomp$0) {
						var chunk$jscomp$0 = endChunkForTag("head");
						destination.push(chunk$jscomp$0);
					}
					var bodyChunks = preamble$jscomp$0.bodyChunks;
					if (bodyChunks) for (completedPreambleSegments = 0; completedPreambleSegments < bodyChunks.length; completedPreambleSegments++) destination.push(bodyChunks[completedPreambleSegments]);
					flushSegment(request, destination, completedRootSegment, null);
					request.completedRootSegment = null;
					var renderState$jscomp$0 = request.renderState;
					if (0 !== request.allPendingTasks || 0 !== request.clientRenderedBoundaries.length || 0 !== request.completedBoundaries.length || null !== request.trackedPostpones && (0 !== request.trackedPostpones.rootNodes.length || null !== request.trackedPostpones.rootSlots)) {
						var resumableState$jscomp$0 = request.resumableState;
						if (0 === (resumableState$jscomp$0.instructions & 64)) {
							resumableState$jscomp$0.instructions |= 64;
							destination.push(renderState$jscomp$0.startInlineScript);
							if (0 === (resumableState$jscomp$0.instructions & 32)) {
								resumableState$jscomp$0.instructions |= 32;
								var shellId = "_" + resumableState$jscomp$0.idPrefix + "R_";
								destination.push(" id=\"");
								var chunk$jscomp$1 = escapeTextForBrowser(shellId);
								destination.push(chunk$jscomp$1);
								destination.push("\"");
							}
							destination.push(">");
							destination.push("requestAnimationFrame(function(){$RT=performance.now()});");
							destination.push("<\/script>");
						}
					}
					writeBootstrap(destination, renderState$jscomp$0);
				}
				var renderState$jscomp$1 = request.renderState;
				completedRootSegment = 0;
				var viewportChunks$jscomp$0 = renderState$jscomp$1.viewportChunks;
				for (completedRootSegment = 0; completedRootSegment < viewportChunks$jscomp$0.length; completedRootSegment++) destination.push(viewportChunks$jscomp$0[completedRootSegment]);
				viewportChunks$jscomp$0.length = 0;
				renderState$jscomp$1.preconnects.forEach(flushResource, destination);
				renderState$jscomp$1.preconnects.clear();
				renderState$jscomp$1.fontPreloads.forEach(flushResource, destination);
				renderState$jscomp$1.fontPreloads.clear();
				renderState$jscomp$1.highImagePreloads.forEach(flushResource, destination);
				renderState$jscomp$1.highImagePreloads.clear();
				renderState$jscomp$1.styles.forEach(preloadLateStyles, destination);
				renderState$jscomp$1.scripts.forEach(flushResource, destination);
				renderState$jscomp$1.scripts.clear();
				renderState$jscomp$1.bulkPreloads.forEach(flushResource, destination);
				renderState$jscomp$1.bulkPreloads.clear();
				var hoistableChunks$jscomp$0 = renderState$jscomp$1.hoistableChunks;
				for (completedRootSegment = 0; completedRootSegment < hoistableChunks$jscomp$0.length; completedRootSegment++) destination.push(hoistableChunks$jscomp$0[completedRootSegment]);
				hoistableChunks$jscomp$0.length = 0;
				var clientRenderedBoundaries = request.clientRenderedBoundaries;
				for (i = 0; i < clientRenderedBoundaries.length; i++) {
					var boundary = clientRenderedBoundaries[i];
					renderState$jscomp$1 = destination;
					var resumableState$jscomp$1 = request.resumableState, renderState$jscomp$2 = request.renderState, id = boundary.rootSegmentID, errorDigest = boundary.errorDigest;
					renderState$jscomp$1.push(renderState$jscomp$2.startInlineScript);
					renderState$jscomp$1.push(">");
					0 === (resumableState$jscomp$1.instructions & 4) ? (resumableState$jscomp$1.instructions |= 4, renderState$jscomp$1.push("$RX=function(b,c,d,e,f){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data=\"$!\",a=a.dataset,null!=c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),f&&(a.cstck=f),b._reactRetry&&b._reactRetry())};;$RX(\"")) : renderState$jscomp$1.push("$RX(\"");
					renderState$jscomp$1.push(renderState$jscomp$2.boundaryPrefix);
					var chunk$jscomp$2 = id.toString(16);
					renderState$jscomp$1.push(chunk$jscomp$2);
					renderState$jscomp$1.push("\"");
					if (null != errorDigest) if (renderState$jscomp$1.push(","), null == errorDigest) renderState$jscomp$1.push("null");
					else {
						var chunk$jscomp$3 = escapeJSStringsForInstructionScripts(errorDigest);
						renderState$jscomp$1.push(chunk$jscomp$3);
					}
					var JSCompiler_inline_result = renderState$jscomp$1.push(")<\/script>");
					if (!JSCompiler_inline_result) {
						request.destination = null;
						i++;
						clientRenderedBoundaries.splice(0, i);
						return;
					}
				}
				clientRenderedBoundaries.splice(0, i);
				var completedBoundaries = request.completedBoundaries;
				for (i = 0; i < completedBoundaries.length; i++) if (!flushCompletedBoundary(request, destination, completedBoundaries[i])) {
					request.destination = null;
					i++;
					completedBoundaries.splice(0, i);
					return;
				}
				completedBoundaries.splice(0, i);
				flushingPartialBoundaries = !0;
				var partialBoundaries = request.partialBoundaries;
				for (i = 0; i < partialBoundaries.length; i++) {
					var boundary$70 = partialBoundaries[i];
					a: {
						clientRenderedBoundaries = request;
						boundary = destination;
						flushedByteSize = boundary$70.byteSize;
						var completedSegments = boundary$70.completedSegments;
						for (JSCompiler_inline_result = 0; JSCompiler_inline_result < completedSegments.length; JSCompiler_inline_result++) if (!flushPartiallyCompletedSegment(clientRenderedBoundaries, boundary, boundary$70, completedSegments[JSCompiler_inline_result])) {
							JSCompiler_inline_result++;
							completedSegments.splice(0, JSCompiler_inline_result);
							var JSCompiler_inline_result$jscomp$0 = !1;
							break a;
						}
						completedSegments.splice(0, JSCompiler_inline_result);
						var row = boundary$70.row;
						null !== row && row.together && 1 === boundary$70.pendingTasks && (1 === row.pendingTasks ? unblockSuspenseListRow(clientRenderedBoundaries, row, row.hoistables) : row.pendingTasks--);
						JSCompiler_inline_result$jscomp$0 = writeHoistablesForBoundary(boundary, boundary$70.contentState, clientRenderedBoundaries.renderState);
					}
					if (!JSCompiler_inline_result$jscomp$0) {
						request.destination = null;
						i++;
						partialBoundaries.splice(0, i);
						return;
					}
				}
				partialBoundaries.splice(0, i);
				flushingPartialBoundaries = !1;
				var largeBoundaries = request.completedBoundaries;
				for (i = 0; i < largeBoundaries.length; i++) if (!flushCompletedBoundary(request, destination, largeBoundaries[i])) {
					request.destination = null;
					i++;
					largeBoundaries.splice(0, i);
					return;
				}
				largeBoundaries.splice(0, i);
			}
		} finally {
			flushingPartialBoundaries = !1, i = request.postponedState, null !== i && (i.nextSegmentId = request.nextSegmentId), 0 === request.allPendingTasks && 0 === request.clientRenderedBoundaries.length && 0 === request.completedBoundaries.length && (request.flushScheduled = !1, i = request.resumableState, i.hasBody && (partialBoundaries = endChunkForTag("body"), destination.push(partialBoundaries)), i.hasHtml && (i = endChunkForTag("html"), destination.push(i)), endRenderLifetime(request), request.status = 13, destination.push(null), request.destination = null);
		}
	}
	function enqueueFlush(request) {
		if (!1 === request.flushScheduled && 0 === request.pingedTasks.length && null !== request.destination) {
			request.flushScheduled = !0;
			var destination = request.destination;
			destination ? flushCompletedQueues(request, destination) : request.flushScheduled = !1;
		}
	}
	function startFlowing(request, destination) {
		if (12 === request.status) request.status = 13, request = request.fatalError, isRecoverableError(request) && (request = cloneRecoverableErrorAsFatal(request)), destination.destroy(request);
		else if (13 !== request.status && null === request.destination) {
			request.destination = destination;
			try {
				flushCompletedQueues(request, destination);
			} catch (error$72) {
				logRecoverableError(request, error$72, {}), fatalError(request, error$72);
			}
		}
	}
	function finishAbort(request, abortableTasks) {
		try {
			if (0 < abortableTasks.size) {
				var error = request.fatalError;
				abortableTasks.forEach(function(task) {
					return finishAbortedTask(task, request, error);
				});
				abortableTasks.clear();
			}
			null !== request.destination && flushCompletedQueues(request, request.destination);
		} catch (error$73) {
			logRecoverableError(request, error$73, {}), fatalError(request, error$73);
		}
	}
	function endRenderLifetime(request) {
		request = request.renderLifetimeController;
		null !== request && request.abort("The render ended.");
	}
	function abort(request, reason) {
		if (!(request.aborted || 11 !== request.status && 10 !== request.status)) {
			endRenderLifetime(request);
			var isRecoverableReason = "object" === typeof reason && null !== reason && reason.$$typeof === REACT_RECOVERABLE_TYPE;
			request.aborted = !0;
			reason = isRecoverableReason ? createRecoverableError(reason) : void 0 === reason ? Error("The render was aborted by the server without a reason.") : "object" === typeof reason && null !== reason && "function" === typeof reason.then ? Error("The render was aborted by the server with a promise.") : reason;
			request.fatalError = reason;
			reason = request.abortableTasks;
			reason.forEach(function(task) {
				return abortTask(task, request);
			});
			finishAbort(request, reason);
		}
	}
	function addToReplayParent(node, parentKeyPath, trackedPostpones) {
		if (null === parentKeyPath) trackedPostpones.rootNodes.push(node);
		else {
			var workingMap = trackedPostpones.workingMap, parentNode = workingMap.get(parentKeyPath);
			void 0 === parentNode && (parentNode = [
				parentKeyPath[1],
				parentKeyPath[2],
				[],
				null
			], workingMap.set(parentKeyPath, parentNode), addToReplayParent(parentNode, parentKeyPath[0], trackedPostpones));
			parentNode[2].push(node);
		}
	}
	function onError() {}
	function renderToStringImpl(children, options, generateStaticMarkup, abortReason) {
		var didFatal = !1, fatalError = null, result = "", readyToStream = !1;
		options = createResumableState(options ? options.identifierPrefix : void 0);
		children = createRequest(children, options, createRenderState(options, generateStaticMarkup), createFormatContext(0, null, 0, null), Infinity, onError, void 0, void 0, function() {
			readyToStream = !0;
		}, void 0, void 0, void 0);
		children.flushScheduled = null !== children.destination;
		performWork(children);
		10 === children.status && (children.status = 11);
		null === children.trackedPostpones && safelyEmitEarlyPreloads(children, 0 === children.pendingRootTasks);
		abort(children, abortReason);
		startFlowing(children, {
			push: function(chunk) {
				null !== chunk && (result += chunk);
				return !0;
			},
			destroy: function(error) {
				didFatal = !0;
				fatalError = error;
			}
		});
		if (didFatal && fatalError !== abortReason) throw fatalError;
		if (!readyToStream) throw Error("A component suspended while responding to synchronous input. This will cause the UI to be replaced with a loading indicator. To fix, updates that suspend should be wrapped with startTransition.");
		return result;
	}
	exports.renderToStaticMarkup = function(children, options) {
		return renderToStringImpl(children, options, !0, "The server used \"renderToStaticMarkup\" which does not support Suspense. If you intended to have the server wait for the suspended component please switch to \"renderToPipeableStream\" which supports Suspense on the server");
	};
	exports.renderToString = function(children, options) {
		return renderToStringImpl(children, options, !1, "The server used \"renderToString\" which does not support Suspense. If you intended for this Suspense boundary to render the fallback content on the server consider throwing an Error somewhere within the Suspense boundary. If you intended to have the server wait for the suspended component please switch to \"renderToPipeableStream\" which supports Suspense on the server");
	};
	exports.version = "19.3.0";
}));
//#endregion
//#region node_modules/react-dom/cjs/react-dom-server.node.production.js
/**
* @license React
* react-dom-server.node.production.js
*
* Copyright (c) Meta Platforms, Inc. and affiliates.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
var require_react_dom_server_node_production = /* @__PURE__ */ __commonJSMin(((exports) => {
	var util = __require("util");
	var crypto = __require("crypto");
	var async_hooks = __require("async_hooks");
	var React = require_react();
	var ReactDOM = require_react_dom();
	var stream = __require("stream");
	var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element");
	var REACT_PORTAL_TYPE = Symbol.for("react.portal");
	var REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
	var REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
	var REACT_PROFILER_TYPE = Symbol.for("react.profiler");
	var REACT_CONSUMER_TYPE = Symbol.for("react.consumer");
	var REACT_CONTEXT_TYPE = Symbol.for("react.context");
	var REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
	var REACT_SUSPENSE_TYPE = Symbol.for("react.suspense");
	var REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list");
	var REACT_MEMO_TYPE = Symbol.for("react.memo");
	var REACT_LAZY_TYPE = Symbol.for("react.lazy");
	var REACT_SCOPE_TYPE = Symbol.for("react.scope");
	var REACT_ACTIVITY_TYPE = Symbol.for("react.activity");
	var REACT_LEGACY_HIDDEN_TYPE = Symbol.for("react.legacy_hidden");
	var REACT_MEMO_CACHE_SENTINEL = Symbol.for("react.memo_cache_sentinel");
	var REACT_VIEW_TRANSITION_TYPE = Symbol.for("react.view_transition");
	var REACT_RECOVERABLE_TYPE = Symbol.for("react.recoverable");
	var MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
	function getIteratorFn(maybeIterable) {
		if (null === maybeIterable || "object" !== typeof maybeIterable) return null;
		maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
		return "function" === typeof maybeIterable ? maybeIterable : null;
	}
	var REACT_OPTIMISTIC_KEY = Symbol.for("react.optimistic_key");
	var isArrayImpl = Array.isArray;
	var scheduleMicrotask = queueMicrotask;
	function flushBuffered(destination) {
		"function" === typeof destination.flush && destination.flush();
	}
	var currentView = null;
	var writtenBytes = 0;
	var destinationHasCapacity$1 = !0;
	function writeChunk(destination, chunk) {
		if ("string" === typeof chunk) {
			if (0 !== chunk.length) if (4096 < 3 * chunk.length) 0 < writtenBytes && (writeToDestination(destination, currentView.subarray(0, writtenBytes)), currentView = /* @__PURE__ */ new Uint8Array(4096), writtenBytes = 0), writeToDestination(destination, chunk);
			else {
				var target = currentView;
				0 < writtenBytes && (target = currentView.subarray(writtenBytes));
				target = textEncoder.encodeInto(chunk, target);
				var read = target.read;
				writtenBytes += target.written;
				read < chunk.length && (writeToDestination(destination, currentView.subarray(0, writtenBytes)), currentView = /* @__PURE__ */ new Uint8Array(4096), writtenBytes = textEncoder.encodeInto(chunk.slice(read), currentView).written);
				4096 === writtenBytes && (writeToDestination(destination, currentView), currentView = /* @__PURE__ */ new Uint8Array(4096), writtenBytes = 0);
			}
		} else 0 !== chunk.byteLength && (4096 < chunk.byteLength ? (0 < writtenBytes && (writeToDestination(destination, currentView.subarray(0, writtenBytes)), currentView = /* @__PURE__ */ new Uint8Array(4096), writtenBytes = 0), writeToDestination(destination, chunk)) : (target = currentView.length - writtenBytes, target < chunk.byteLength && (0 === target ? writeToDestination(destination, currentView) : (currentView.set(chunk.subarray(0, target), writtenBytes), writtenBytes += target, writeToDestination(destination, currentView), chunk = chunk.subarray(target)), currentView = /* @__PURE__ */ new Uint8Array(4096), writtenBytes = 0), currentView.set(chunk, writtenBytes), writtenBytes += chunk.byteLength, 4096 === writtenBytes && (writeToDestination(destination, currentView), currentView = /* @__PURE__ */ new Uint8Array(4096), writtenBytes = 0)));
	}
	function writeToDestination(destination, view) {
		destination = destination.write(view);
		destinationHasCapacity$1 = destinationHasCapacity$1 && destination;
	}
	function writeChunkAndReturn(destination, chunk) {
		writeChunk(destination, chunk);
		return destinationHasCapacity$1;
	}
	function completeWriting(destination) {
		currentView && 0 < writtenBytes && destination.write(currentView.subarray(0, writtenBytes));
		currentView = null;
		writtenBytes = 0;
		destinationHasCapacity$1 = !0;
	}
	var textEncoder = new util.TextEncoder();
	function stringToPrecomputedChunk(content) {
		return textEncoder.encode(content);
	}
	function byteLengthOfChunk(chunk) {
		return "string" === typeof chunk ? Buffer.byteLength(chunk, "utf8") : chunk.byteLength;
	}
	var assign = Object.assign;
	var hasOwnProperty = Object.prototype.hasOwnProperty;
	var VALID_ATTRIBUTE_NAME_REGEX = RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$");
	var illegalAttributeNameCache = {};
	var validatedAttributeNameCache = {};
	function isAttributeNameSafe(attributeName) {
		if (hasOwnProperty.call(validatedAttributeNameCache, attributeName)) return !0;
		if (hasOwnProperty.call(illegalAttributeNameCache, attributeName)) return !1;
		if (VALID_ATTRIBUTE_NAME_REGEX.test(attributeName)) return validatedAttributeNameCache[attributeName] = !0;
		illegalAttributeNameCache[attributeName] = !0;
		return !1;
	}
	var unitlessNumbers = new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));
	var aliases = /* @__PURE__ */ new Map([
		["acceptCharset", "accept-charset"],
		["htmlFor", "for"],
		["httpEquiv", "http-equiv"],
		["crossOrigin", "crossorigin"],
		["accentHeight", "accent-height"],
		["alignmentBaseline", "alignment-baseline"],
		["arabicForm", "arabic-form"],
		["baselineShift", "baseline-shift"],
		["capHeight", "cap-height"],
		["clipPath", "clip-path"],
		["clipRule", "clip-rule"],
		["colorInterpolation", "color-interpolation"],
		["colorInterpolationFilters", "color-interpolation-filters"],
		["colorProfile", "color-profile"],
		["colorRendering", "color-rendering"],
		["dominantBaseline", "dominant-baseline"],
		["enableBackground", "enable-background"],
		["fillOpacity", "fill-opacity"],
		["fillRule", "fill-rule"],
		["floodColor", "flood-color"],
		["floodOpacity", "flood-opacity"],
		["fontFamily", "font-family"],
		["fontSize", "font-size"],
		["fontSizeAdjust", "font-size-adjust"],
		["fontStretch", "font-stretch"],
		["fontStyle", "font-style"],
		["fontVariant", "font-variant"],
		["fontWeight", "font-weight"],
		["glyphName", "glyph-name"],
		["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
		["glyphOrientationVertical", "glyph-orientation-vertical"],
		["horizAdvX", "horiz-adv-x"],
		["horizOriginX", "horiz-origin-x"],
		["imageRendering", "image-rendering"],
		["letterSpacing", "letter-spacing"],
		["lightingColor", "lighting-color"],
		["markerEnd", "marker-end"],
		["markerMid", "marker-mid"],
		["markerStart", "marker-start"],
		["maskType", "mask-type"],
		["overlinePosition", "overline-position"],
		["overlineThickness", "overline-thickness"],
		["paintOrder", "paint-order"],
		["panose-1", "panose-1"],
		["pointerEvents", "pointer-events"],
		["renderingIntent", "rendering-intent"],
		["shapeRendering", "shape-rendering"],
		["stopColor", "stop-color"],
		["stopOpacity", "stop-opacity"],
		["strikethroughPosition", "strikethrough-position"],
		["strikethroughThickness", "strikethrough-thickness"],
		["strokeDasharray", "stroke-dasharray"],
		["strokeDashoffset", "stroke-dashoffset"],
		["strokeLinecap", "stroke-linecap"],
		["strokeLinejoin", "stroke-linejoin"],
		["strokeMiterlimit", "stroke-miterlimit"],
		["strokeOpacity", "stroke-opacity"],
		["strokeWidth", "stroke-width"],
		["textAnchor", "text-anchor"],
		["textDecoration", "text-decoration"],
		["textRendering", "text-rendering"],
		["transformOrigin", "transform-origin"],
		["underlinePosition", "underline-position"],
		["underlineThickness", "underline-thickness"],
		["unicodeBidi", "unicode-bidi"],
		["unicodeRange", "unicode-range"],
		["unitsPerEm", "units-per-em"],
		["vAlphabetic", "v-alphabetic"],
		["vHanging", "v-hanging"],
		["vIdeographic", "v-ideographic"],
		["vMathematical", "v-mathematical"],
		["vectorEffect", "vector-effect"],
		["vertAdvY", "vert-adv-y"],
		["vertOriginX", "vert-origin-x"],
		["vertOriginY", "vert-origin-y"],
		["wordSpacing", "word-spacing"],
		["writingMode", "writing-mode"],
		["xmlnsXlink", "xmlns:xlink"],
		["xHeight", "x-height"]
	]);
	var matchHtmlRegExp = /["'&<>]/;
	function escapeTextForBrowser(text) {
		if ("boolean" === typeof text || "number" === typeof text || "bigint" === typeof text) return "" + text;
		text = "" + text;
		var match = matchHtmlRegExp.exec(text);
		if (match) {
			var html = "", index, lastIndex = 0;
			for (index = match.index; index < text.length; index++) {
				switch (text.charCodeAt(index)) {
					case 34:
						match = "&quot;";
						break;
					case 38:
						match = "&amp;";
						break;
					case 39:
						match = "&#x27;";
						break;
					case 60:
						match = "&lt;";
						break;
					case 62:
						match = "&gt;";
						break;
					default: continue;
				}
				lastIndex !== index && (html += text.slice(lastIndex, index));
				lastIndex = index + 1;
				html += match;
			}
			text = lastIndex !== index ? html + text.slice(lastIndex, index) : html;
		}
		return text;
	}
	var uppercasePattern = /([A-Z])/g;
	var msPattern = /^ms-/;
	var isJavaScriptProtocol = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
	function sanitizeURL(url) {
		return isJavaScriptProtocol.test("" + url) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : url;
	}
	var ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
	var ReactDOMSharedInternals = ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
	var sharedNotPendingObject = {
		pending: !1,
		data: null,
		method: null,
		action: null
	};
	var previousDispatcher = ReactDOMSharedInternals.d;
	ReactDOMSharedInternals.d = {
		f: previousDispatcher.f,
		r: previousDispatcher.r,
		D: prefetchDNS,
		C: preconnect,
		L: preload,
		m: preloadModule,
		X: preinitScript,
		S: preinitStyle,
		M: preinitModuleScript
	};
	var PRELOAD_NO_CREDS = [];
	var currentlyFlushingRenderState = null;
	stringToPrecomputedChunk("\"></template>");
	var startInlineScript = stringToPrecomputedChunk("<script");
	var endInlineScript = stringToPrecomputedChunk("<\/script>");
	var startScriptSrc = stringToPrecomputedChunk("<script src=\"");
	var startModuleSrc = stringToPrecomputedChunk("<script type=\"module\" src=\"");
	var scriptNonce = stringToPrecomputedChunk(" nonce=\"");
	var scriptIntegirty = stringToPrecomputedChunk(" integrity=\"");
	var scriptCrossOrigin = stringToPrecomputedChunk(" crossorigin=\"");
	var endAsyncScript = stringToPrecomputedChunk(" async=\"\"><\/script>");
	var startInlineStyle = stringToPrecomputedChunk("<style");
	var scriptRegex = /(<\/|<)(s)(cript)/gi;
	function scriptReplacer(match, prefix, s, suffix) {
		return "" + prefix + ("s" === s ? "\\u0073" : "\\u0053") + suffix;
	}
	var importMapScriptStart = stringToPrecomputedChunk("<script type=\"importmap\">");
	var importMapScriptEnd = stringToPrecomputedChunk("<\/script>");
	function createRenderState(resumableState, nonce, externalRuntimeConfig, importMap, onHeaders, maxHeadersLength) {
		externalRuntimeConfig = "string" === typeof nonce ? nonce : nonce && nonce.script;
		var inlineScriptWithNonce = void 0 === externalRuntimeConfig ? startInlineScript : stringToPrecomputedChunk("<script nonce=\"" + escapeTextForBrowser(externalRuntimeConfig) + "\""), nonceStyle = "string" === typeof nonce ? void 0 : nonce && nonce.style, inlineStyleWithNonce = void 0 === nonceStyle ? startInlineStyle : stringToPrecomputedChunk("<style nonce=\"" + escapeTextForBrowser(nonceStyle) + "\""), idPrefix = resumableState.idPrefix, bootstrapChunks = [], bootstrapScriptContent = resumableState.bootstrapScriptContent, bootstrapScripts = resumableState.bootstrapScripts, bootstrapModules = resumableState.bootstrapModules;
		void 0 !== bootstrapScriptContent && (bootstrapChunks.push(inlineScriptWithNonce), pushCompletedShellIdAttribute(bootstrapChunks, resumableState), bootstrapChunks.push(endOfStartTag, ("" + bootstrapScriptContent).replace(scriptRegex, scriptReplacer), endInlineScript));
		bootstrapScriptContent = [];
		void 0 !== importMap && (bootstrapScriptContent.push(void 0 === externalRuntimeConfig ? importMapScriptStart : stringToPrecomputedChunk("<script type=\"importmap\" nonce=\"" + escapeTextForBrowser(externalRuntimeConfig) + "\">")), bootstrapScriptContent.push(("" + JSON.stringify(importMap)).replace(scriptRegex, scriptReplacer)), bootstrapScriptContent.push(importMapScriptEnd));
		importMap = onHeaders ? {
			preconnects: "",
			fontPreloads: "",
			highImagePreloads: "",
			remainingCapacity: 2 + ("number" === typeof maxHeadersLength ? maxHeadersLength : 2e3)
		} : null;
		onHeaders = {
			placeholderPrefix: stringToPrecomputedChunk(idPrefix + "P:"),
			segmentPrefix: stringToPrecomputedChunk(idPrefix + "S:"),
			boundaryPrefix: stringToPrecomputedChunk(idPrefix + "B:"),
			startInlineScript: inlineScriptWithNonce,
			startInlineStyle: inlineStyleWithNonce,
			preamble: createPreambleState(),
			externalRuntimeScript: null,
			bootstrapChunks,
			importMapChunks: bootstrapScriptContent,
			onHeaders,
			headers: importMap,
			resets: {
				font: {},
				dns: {},
				connect: {
					default: {},
					anonymous: {},
					credentials: {}
				},
				image: {},
				style: {}
			},
			charsetChunks: [],
			viewportChunks: [],
			hoistableChunks: [],
			preconnects: /* @__PURE__ */ new Set(),
			fontPreloads: /* @__PURE__ */ new Set(),
			highImagePreloads: /* @__PURE__ */ new Set(),
			styles: /* @__PURE__ */ new Map(),
			bootstrapScripts: /* @__PURE__ */ new Set(),
			scripts: /* @__PURE__ */ new Set(),
			bulkPreloads: /* @__PURE__ */ new Set(),
			preloads: {
				images: /* @__PURE__ */ new Map(),
				stylesheets: /* @__PURE__ */ new Map(),
				scripts: /* @__PURE__ */ new Map(),
				moduleScripts: /* @__PURE__ */ new Map()
			},
			nonce: {
				script: externalRuntimeConfig,
				style: nonceStyle
			},
			hoistableState: null,
			stylesToHoist: !1
		};
		if (void 0 !== bootstrapScripts) for (importMap = 0; importMap < bootstrapScripts.length; importMap++) idPrefix = bootstrapScripts[importMap], nonceStyle = inlineScriptWithNonce = void 0, inlineStyleWithNonce = {
			rel: "preload",
			as: "script",
			fetchPriority: "low",
			nonce
		}, "string" === typeof idPrefix ? inlineStyleWithNonce.href = maxHeadersLength = idPrefix : (inlineStyleWithNonce.href = maxHeadersLength = idPrefix.src, inlineStyleWithNonce.integrity = nonceStyle = "string" === typeof idPrefix.integrity ? idPrefix.integrity : void 0, inlineStyleWithNonce.crossOrigin = inlineScriptWithNonce = "string" === typeof idPrefix || null == idPrefix.crossOrigin ? void 0 : "use-credentials" === idPrefix.crossOrigin ? "use-credentials" : ""), idPrefix = resumableState, bootstrapScriptContent = maxHeadersLength, idPrefix.scriptResources[bootstrapScriptContent] = null, idPrefix.moduleScriptResources[bootstrapScriptContent] = null, idPrefix = [], pushLinkImpl(idPrefix, inlineStyleWithNonce), onHeaders.bootstrapScripts.add(idPrefix), bootstrapChunks.push(startScriptSrc, escapeTextForBrowser(maxHeadersLength), attributeEnd), externalRuntimeConfig && bootstrapChunks.push(scriptNonce, escapeTextForBrowser(externalRuntimeConfig), attributeEnd), "string" === typeof nonceStyle && bootstrapChunks.push(scriptIntegirty, escapeTextForBrowser(nonceStyle), attributeEnd), "string" === typeof inlineScriptWithNonce && bootstrapChunks.push(scriptCrossOrigin, escapeTextForBrowser(inlineScriptWithNonce), attributeEnd), pushCompletedShellIdAttribute(bootstrapChunks, resumableState), bootstrapChunks.push(endAsyncScript);
		if (void 0 !== bootstrapModules) for (nonce = 0; nonce < bootstrapModules.length; nonce++) nonceStyle = bootstrapModules[nonce], maxHeadersLength = importMap = void 0, inlineScriptWithNonce = {
			rel: "modulepreload",
			fetchPriority: "low",
			nonce: externalRuntimeConfig
		}, "string" === typeof nonceStyle ? inlineScriptWithNonce.href = bootstrapScripts = nonceStyle : (inlineScriptWithNonce.href = bootstrapScripts = nonceStyle.src, inlineScriptWithNonce.integrity = maxHeadersLength = "string" === typeof nonceStyle.integrity ? nonceStyle.integrity : void 0, inlineScriptWithNonce.crossOrigin = importMap = "string" === typeof nonceStyle || null == nonceStyle.crossOrigin ? void 0 : "use-credentials" === nonceStyle.crossOrigin ? "use-credentials" : ""), nonceStyle = resumableState, inlineStyleWithNonce = bootstrapScripts, nonceStyle.scriptResources[inlineStyleWithNonce] = null, nonceStyle.moduleScriptResources[inlineStyleWithNonce] = null, nonceStyle = [], pushLinkImpl(nonceStyle, inlineScriptWithNonce), onHeaders.bootstrapScripts.add(nonceStyle), bootstrapChunks.push(startModuleSrc, escapeTextForBrowser(bootstrapScripts), attributeEnd), externalRuntimeConfig && bootstrapChunks.push(scriptNonce, escapeTextForBrowser(externalRuntimeConfig), attributeEnd), "string" === typeof maxHeadersLength && bootstrapChunks.push(scriptIntegirty, escapeTextForBrowser(maxHeadersLength), attributeEnd), "string" === typeof importMap && bootstrapChunks.push(scriptCrossOrigin, escapeTextForBrowser(importMap), attributeEnd), pushCompletedShellIdAttribute(bootstrapChunks, resumableState), bootstrapChunks.push(endAsyncScript);
		return onHeaders;
	}
	function createResumableState(identifierPrefix, externalRuntimeConfig, bootstrapScriptContent, bootstrapScripts, bootstrapModules) {
		return {
			idPrefix: void 0 === identifierPrefix ? "" : identifierPrefix,
			nextFormID: 0,
			streamingFormat: 0,
			bootstrapScriptContent,
			bootstrapScripts,
			bootstrapModules,
			instructions: 0,
			hasBody: !1,
			hasHtml: !1,
			unknownResources: {},
			dnsResources: {},
			connectResources: {
				default: {},
				anonymous: {},
				credentials: {}
			},
			imageResources: {},
			styleResources: {},
			scriptResources: {},
			moduleUnknownResources: {},
			moduleScriptResources: {}
		};
	}
	function createPreambleState() {
		return {
			htmlChunks: null,
			headChunks: null,
			bodyChunks: null
		};
	}
	function createFormatContext(insertionMode, selectedValue, tagScope, viewTransition) {
		return {
			insertionMode,
			selectedValue,
			tagScope,
			viewTransition
		};
	}
	function createRootFormatContext(namespaceURI) {
		return createFormatContext("http://www.w3.org/2000/svg" === namespaceURI ? 4 : "http://www.w3.org/1998/Math/MathML" === namespaceURI ? 5 : 0, null, 0, null);
	}
	function getChildFormatContext(parentContext, type, props) {
		var subtreeScope = parentContext.tagScope & -25;
		switch (type) {
			case "noscript": return createFormatContext(2, null, subtreeScope | 1, null);
			case "select": return createFormatContext(2, null != props.value ? props.value : props.defaultValue, subtreeScope, null);
			case "svg": return createFormatContext(4, null, subtreeScope, null);
			case "picture": return createFormatContext(2, null, subtreeScope | 2, null);
			case "math": return createFormatContext(5, null, subtreeScope, null);
			case "foreignObject": return createFormatContext(2, null, subtreeScope, null);
			case "table": return createFormatContext(6, null, subtreeScope, null);
			case "thead":
			case "tbody":
			case "tfoot": return createFormatContext(7, null, subtreeScope, null);
			case "colgroup": return createFormatContext(9, null, subtreeScope, null);
			case "tr": return createFormatContext(8, null, subtreeScope, null);
			case "head":
				if (2 > parentContext.insertionMode) return createFormatContext(3, null, subtreeScope, null);
				break;
			case "html": if (0 === parentContext.insertionMode) return createFormatContext(1, null, subtreeScope, null);
		}
		return 6 <= parentContext.insertionMode || 2 > parentContext.insertionMode ? createFormatContext(2, null, subtreeScope, null) : null !== parentContext.viewTransition || parentContext.tagScope !== subtreeScope ? createFormatContext(parentContext.insertionMode, parentContext.selectedValue, subtreeScope, null) : parentContext;
	}
	function getSuspenseViewTransition(parentViewTransition) {
		return null === parentViewTransition ? null : {
			update: parentViewTransition.update,
			enter: "none",
			exit: "none",
			share: parentViewTransition.update,
			parentEnter: "none",
			parentExit: "none",
			name: parentViewTransition.autoName,
			autoName: parentViewTransition.autoName,
			nameIdx: 0
		};
	}
	function getSuspenseFallbackFormatContext(resumableState, parentContext) {
		parentContext.tagScope & 32 && (resumableState.instructions |= 128);
		return createFormatContext(parentContext.insertionMode, parentContext.selectedValue, parentContext.tagScope | 12, getSuspenseViewTransition(parentContext.viewTransition));
	}
	function getSuspenseContentFormatContext(resumableState, parentContext) {
		resumableState = getSuspenseViewTransition(parentContext.viewTransition);
		var subtreeScope = parentContext.tagScope | 16;
		null !== resumableState && "none" !== resumableState.share && (subtreeScope |= 64);
		return createFormatContext(parentContext.insertionMode, parentContext.selectedValue, subtreeScope, resumableState);
	}
	function makeId(resumableState, treeId, localId) {
		resumableState = "_" + resumableState.idPrefix + "R_" + treeId;
		0 < localId && (resumableState += "H" + localId.toString(32));
		return resumableState + "_";
	}
	var textSeparator = stringToPrecomputedChunk("<!-- -->");
	function pushTextInstance(target, text, renderState, textEmbedded) {
		if ("" === text) return textEmbedded;
		textEmbedded && target.push(textSeparator);
		target.push(escapeTextForBrowser(text));
		return !0;
	}
	function pushViewTransitionAttributes(target, formatContext) {
		formatContext = formatContext.viewTransition;
		null !== formatContext && ("auto" !== formatContext.name && (pushStringAttribute(target, "vt-name", 0 === formatContext.nameIdx ? formatContext.name : formatContext.name + "_" + formatContext.nameIdx), formatContext.nameIdx++), pushStringAttribute(target, "vt-update", formatContext.update), "none" !== formatContext.enter && pushStringAttribute(target, "vt-enter", formatContext.enter), "none" !== formatContext.exit && pushStringAttribute(target, "vt-exit", formatContext.exit), "none" !== formatContext.share && pushStringAttribute(target, "vt-share", formatContext.share));
	}
	var styleNameCache = /* @__PURE__ */ new Map();
	var styleAttributeStart = stringToPrecomputedChunk(" style=\"");
	var styleAssign = stringToPrecomputedChunk(":");
	var styleSeparator = stringToPrecomputedChunk(";");
	function pushStyleAttribute(target, style) {
		if ("object" !== typeof style) throw Error("The `style` prop expects a mapping from style properties to values, not a string. For example, style={{marginRight: spacing + 'em'}} when using JSX.");
		var isFirst = !0, styleName;
		for (styleName in style) if (hasOwnProperty.call(style, styleName)) {
			var styleValue = style[styleName];
			if (null != styleValue && "boolean" !== typeof styleValue && "" !== styleValue) {
				if (0 === styleName.indexOf("--")) {
					var nameChunk = escapeTextForBrowser(styleName);
					styleValue = escapeTextForBrowser(("" + styleValue).trim());
				} else nameChunk = styleNameCache.get(styleName), void 0 === nameChunk && (nameChunk = stringToPrecomputedChunk(escapeTextForBrowser(styleName.replace(uppercasePattern, "-$1").toLowerCase().replace(msPattern, "-ms-"))), styleNameCache.set(styleName, nameChunk)), styleValue = "number" === typeof styleValue ? 0 === styleValue || unitlessNumbers.has(styleName) ? "" + styleValue : styleValue + "px" : escapeTextForBrowser(("" + styleValue).trim());
				isFirst ? (isFirst = !1, target.push(styleAttributeStart, nameChunk, styleAssign, styleValue)) : target.push(styleSeparator, nameChunk, styleAssign, styleValue);
			}
		}
		isFirst || target.push(attributeEnd);
	}
	var attributeSeparator = stringToPrecomputedChunk(" ");
	var attributeAssign = stringToPrecomputedChunk("=\"");
	var attributeEnd = stringToPrecomputedChunk("\"");
	var attributeEmptyString = stringToPrecomputedChunk("=\"\"");
	function pushBooleanAttribute(target, name, value) {
		value && "function" !== typeof value && "symbol" !== typeof value && target.push(attributeSeparator, name, attributeEmptyString);
	}
	function pushStringAttribute(target, name, value) {
		"function" !== typeof value && "symbol" !== typeof value && "boolean" !== typeof value && target.push(attributeSeparator, name, attributeAssign, escapeTextForBrowser(value), attributeEnd);
	}
	var actionJavaScriptURL = stringToPrecomputedChunk(escapeTextForBrowser("javascript:throw new Error('React form unexpectedly submitted.')"));
	var startHiddenInputChunk = stringToPrecomputedChunk("<input type=\"hidden\"");
	function pushAdditionalFormField(value, key) {
		this.push(startHiddenInputChunk);
		validateAdditionalFormField(value);
		pushStringAttribute(this, "name", key);
		pushStringAttribute(this, "value", value);
		this.push(endOfStartTagSelfClosing);
	}
	function validateAdditionalFormField(value) {
		if ("string" !== typeof value) throw Error("File/Blob fields are not yet supported in progressive forms. Will fallback to client hydration.");
	}
	function getCustomFormFields(resumableState, formAction) {
		if ("function" === typeof formAction.$$FORM_ACTION) {
			var id = resumableState.nextFormID++;
			resumableState = resumableState.idPrefix + id;
			try {
				var customFields = formAction.$$FORM_ACTION(resumableState);
				if (customFields) customFields.data?.forEach(validateAdditionalFormField);
				return customFields;
			} catch (x) {
				if ("object" === typeof x && null !== x && "function" === typeof x.then) throw x;
			}
		}
		return null;
	}
	function pushFormActionAttribute(target, resumableState, renderState, formAction, formEncType, formMethod, formTarget, name) {
		var formData = null;
		if ("function" === typeof formAction) {
			var customFields = getCustomFormFields(resumableState, formAction);
			null !== customFields ? (name = customFields.name, formAction = customFields.action || "", formEncType = customFields.encType, formMethod = customFields.method, formTarget = customFields.target, formData = customFields.data) : (target.push(attributeSeparator, "formAction", attributeAssign, actionJavaScriptURL, attributeEnd), formTarget = formMethod = formEncType = formAction = name = null, injectFormReplayingRuntime(resumableState, renderState));
		}
		null != name && pushAttribute(target, "name", name);
		null != formAction && pushAttribute(target, "formAction", formAction);
		null != formEncType && pushAttribute(target, "formEncType", formEncType);
		null != formMethod && pushAttribute(target, "formMethod", formMethod);
		null != formTarget && pushAttribute(target, "formTarget", formTarget);
		return formData;
	}
	function pushAttribute(target, name, value) {
		switch (name) {
			case "className":
				pushStringAttribute(target, "class", value);
				break;
			case "tabIndex":
				pushStringAttribute(target, "tabindex", value);
				break;
			case "dir":
			case "role":
			case "viewBox":
			case "width":
			case "height":
				pushStringAttribute(target, name, value);
				break;
			case "style":
				pushStyleAttribute(target, value);
				break;
			case "src":
			case "href": if ("" === value) break;
			case "action":
			case "formAction":
				if (null == value || "function" === typeof value || "symbol" === typeof value || "boolean" === typeof value) break;
				value = sanitizeURL("" + value);
				target.push(attributeSeparator, name, attributeAssign, escapeTextForBrowser(value), attributeEnd);
				break;
			case "defaultValue":
			case "defaultChecked":
			case "innerHTML":
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "ref": break;
			case "autoFocus":
			case "multiple":
			case "muted":
				pushBooleanAttribute(target, name.toLowerCase(), value);
				break;
			case "xlinkHref":
				if ("function" === typeof value || "symbol" === typeof value || "boolean" === typeof value) break;
				value = sanitizeURL("" + value);
				target.push(attributeSeparator, "xlink:href", attributeAssign, escapeTextForBrowser(value), attributeEnd);
				break;
			case "contentEditable":
			case "spellCheck":
			case "draggable":
			case "value":
			case "autoReverse":
			case "externalResourcesRequired":
			case "focusable":
			case "preserveAlpha":
				"function" !== typeof value && "symbol" !== typeof value && target.push(attributeSeparator, name, attributeAssign, escapeTextForBrowser(value), attributeEnd);
				break;
			case "inert":
			case "allowFullScreen":
			case "async":
			case "autoPlay":
			case "controls":
			case "credentialless":
			case "default":
			case "defer":
			case "disabled":
			case "disablePictureInPicture":
			case "disableRemotePlayback":
			case "formNoValidate":
			case "hidden":
			case "loop":
			case "noModule":
			case "noValidate":
			case "open":
			case "playsInline":
			case "readOnly":
			case "required":
			case "reversed":
			case "scoped":
			case "seamless":
			case "itemScope":
				value && "function" !== typeof value && "symbol" !== typeof value && target.push(attributeSeparator, name, attributeEmptyString);
				break;
			case "capture":
			case "download":
				!0 === value ? target.push(attributeSeparator, name, attributeEmptyString) : !1 !== value && "function" !== typeof value && "symbol" !== typeof value && target.push(attributeSeparator, name, attributeAssign, escapeTextForBrowser(value), attributeEnd);
				break;
			case "cols":
			case "rows":
			case "size":
			case "span":
				"function" !== typeof value && "symbol" !== typeof value && !isNaN(value) && 1 <= value && target.push(attributeSeparator, name, attributeAssign, escapeTextForBrowser(value), attributeEnd);
				break;
			case "rowSpan":
			case "start":
				"function" === typeof value || "symbol" === typeof value || isNaN(value) || target.push(attributeSeparator, name, attributeAssign, escapeTextForBrowser(value), attributeEnd);
				break;
			case "xlinkActuate":
				pushStringAttribute(target, "xlink:actuate", value);
				break;
			case "xlinkArcrole":
				pushStringAttribute(target, "xlink:arcrole", value);
				break;
			case "xlinkRole":
				pushStringAttribute(target, "xlink:role", value);
				break;
			case "xlinkShow":
				pushStringAttribute(target, "xlink:show", value);
				break;
			case "xlinkTitle":
				pushStringAttribute(target, "xlink:title", value);
				break;
			case "xlinkType":
				pushStringAttribute(target, "xlink:type", value);
				break;
			case "xmlBase":
				pushStringAttribute(target, "xml:base", value);
				break;
			case "xmlLang":
				pushStringAttribute(target, "xml:lang", value);
				break;
			case "xmlSpace":
				pushStringAttribute(target, "xml:space", value);
				break;
			default: if (!(2 < name.length) || "o" !== name[0] && "O" !== name[0] || "n" !== name[1] && "N" !== name[1]) {
				if (name = aliases.get(name) || name, isAttributeNameSafe(name)) {
					switch (typeof value) {
						case "function":
						case "symbol": return;
						case "boolean":
							var prefix$8 = name.toLowerCase().slice(0, 5);
							if ("data-" !== prefix$8 && "aria-" !== prefix$8) return;
					}
					target.push(attributeSeparator, name, attributeAssign, escapeTextForBrowser(value), attributeEnd);
				}
			}
		}
	}
	var endOfStartTag = stringToPrecomputedChunk(">");
	var endOfStartTagSelfClosing = stringToPrecomputedChunk("/>");
	function pushInnerHTML(target, innerHTML, children) {
		if (null != innerHTML) {
			if (null != children) throw Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
			if ("object" !== typeof innerHTML || !("__html" in innerHTML)) throw Error("`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://react.dev/link/dangerously-set-inner-html for more information.");
			innerHTML = innerHTML.__html;
			null !== innerHTML && void 0 !== innerHTML && target.push("" + innerHTML);
		}
	}
	function flattenOptionChildren(children) {
		var content = "";
		React.Children.forEach(children, function(child) {
			null != child && (content += child);
		});
		return content;
	}
	var selectedMarkerAttribute = stringToPrecomputedChunk(" selected=\"\"");
	var formReplayingRuntimeScript = stringToPrecomputedChunk("addEventListener(\"submit\",function(a){if(!a.defaultPrevented){var b=a.target,d=a.submitter,c=b.action,e=d;if(d){var f=d.getAttribute(\"formAction\");null!=f&&(c=f,e=null)}\"javascript:throw new Error('React form unexpectedly submitted.')\"===c&&(a.preventDefault(),a=new FormData(b,e),c=b.ownerDocument||b,(c.$$reactFormReplay=c.$$reactFormReplay||[]).push(b,d,a))}});");
	function injectFormReplayingRuntime(resumableState, renderState) {
		if (0 === (resumableState.instructions & 16)) {
			resumableState.instructions |= 16;
			var preamble = renderState.preamble, bootstrapChunks = renderState.bootstrapChunks;
			(preamble.htmlChunks || preamble.headChunks) && 0 === bootstrapChunks.length ? (bootstrapChunks.push(renderState.startInlineScript), pushCompletedShellIdAttribute(bootstrapChunks, resumableState), bootstrapChunks.push(endOfStartTag, formReplayingRuntimeScript, endInlineScript)) : bootstrapChunks.unshift(renderState.startInlineScript, endOfStartTag, formReplayingRuntimeScript, endInlineScript);
		}
	}
	var formStateMarkerIsMatching = stringToPrecomputedChunk("<!--F!-->");
	var formStateMarkerIsNotMatching = stringToPrecomputedChunk("<!--F-->");
	function pushLinkImpl(target, props) {
		target.push(startChunkForTag("link"));
		for (var propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
				case "dangerouslySetInnerHTML": throw Error("link is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.");
				default: pushAttribute(target, propKey, propValue);
			}
		}
		target.push(endOfStartTagSelfClosing);
		return null;
	}
	var styleRegex = /(<\/|<)(s)(tyle)/gi;
	function styleReplacer(match, prefix, s, suffix) {
		return "" + prefix + ("s" === s ? "\\73 " : "\\53 ") + suffix;
	}
	function pushSelfClosing(target, props, tag, formatContext) {
		target.push(startChunkForTag(tag));
		for (var propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
				case "dangerouslySetInnerHTML": throw Error(tag + " is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.");
				default: pushAttribute(target, propKey, propValue);
			}
		}
		pushViewTransitionAttributes(target, formatContext);
		target.push(endOfStartTagSelfClosing);
		return null;
	}
	function pushTitleImpl(target, props) {
		target.push(startChunkForTag("title"));
		var children = null, innerHTML = null, propKey;
		for (propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
					children = propValue;
					break;
				case "dangerouslySetInnerHTML":
					innerHTML = propValue;
					break;
				default: pushAttribute(target, propKey, propValue);
			}
		}
		target.push(endOfStartTag);
		props = Array.isArray(children) ? 2 > children.length ? children[0] : null : children;
		"function" !== typeof props && "symbol" !== typeof props && null !== props && void 0 !== props && target.push(escapeTextForBrowser("" + props));
		pushInnerHTML(target, innerHTML, children);
		target.push(endChunkForTag("title"));
		return null;
	}
	var headPreambleContributionChunk = stringToPrecomputedChunk("<!--head-->");
	var bodyPreambleContributionChunk = stringToPrecomputedChunk("<!--body-->");
	var htmlPreambleContributionChunk = stringToPrecomputedChunk("<!--html-->");
	function pushScriptImpl(target, props) {
		target.push(startChunkForTag("script"));
		var children = null, innerHTML = null, propKey;
		for (propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
					children = propValue;
					break;
				case "dangerouslySetInnerHTML":
					innerHTML = propValue;
					break;
				default: pushAttribute(target, propKey, propValue);
			}
		}
		target.push(endOfStartTag);
		pushInnerHTML(target, innerHTML, children);
		"string" === typeof children && target.push(("" + children).replace(scriptRegex, scriptReplacer));
		target.push(endChunkForTag("script"));
		return null;
	}
	function pushStartSingletonElement(target, props, tag, formatContext) {
		target.push(startChunkForTag(tag));
		var innerHTML = tag = null, propKey;
		for (propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
					tag = propValue;
					break;
				case "dangerouslySetInnerHTML":
					innerHTML = propValue;
					break;
				default: pushAttribute(target, propKey, propValue);
			}
		}
		pushViewTransitionAttributes(target, formatContext);
		target.push(endOfStartTag);
		pushInnerHTML(target, innerHTML, tag);
		return tag;
	}
	function pushStartGenericElement(target, props, tag, formatContext) {
		target.push(startChunkForTag(tag));
		var innerHTML = tag = null, propKey;
		for (propKey in props) if (hasOwnProperty.call(props, propKey)) {
			var propValue = props[propKey];
			if (null != propValue) switch (propKey) {
				case "children":
					tag = propValue;
					break;
				case "dangerouslySetInnerHTML":
					innerHTML = propValue;
					break;
				default: pushAttribute(target, propKey, propValue);
			}
		}
		pushViewTransitionAttributes(target, formatContext);
		target.push(endOfStartTag);
		pushInnerHTML(target, innerHTML, tag);
		return "string" === typeof tag ? (target.push(escapeTextForBrowser(tag)), null) : tag;
	}
	var leadingNewline = stringToPrecomputedChunk("\n");
	var VALID_TAG_REGEX = /^[a-zA-Z][a-zA-Z:_\.\-\d]*$/;
	var validatedTagCache = /* @__PURE__ */ new Map();
	function startChunkForTag(tag) {
		var tagStartChunk = validatedTagCache.get(tag);
		if (void 0 === tagStartChunk) {
			if (!VALID_TAG_REGEX.test(tag)) throw Error("Invalid tag: " + tag);
			tagStartChunk = stringToPrecomputedChunk("<" + tag);
			validatedTagCache.set(tag, tagStartChunk);
		}
		return tagStartChunk;
	}
	var doctypeChunk = stringToPrecomputedChunk("<!DOCTYPE html>");
	function pushStartInstance(target$jscomp$0, type, props, resumableState, renderState, preambleState, hoistableState, formatContext, textEmbedded) {
		switch (type) {
			case "div":
			case "span":
			case "svg":
			case "path": break;
			case "a":
				target$jscomp$0.push(startChunkForTag("a"));
				var children = null, innerHTML = null, propKey;
				for (propKey in props) if (hasOwnProperty.call(props, propKey)) {
					var propValue = props[propKey];
					if (null != propValue) switch (propKey) {
						case "children":
							children = propValue;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML = propValue;
							break;
						case "href":
							"" === propValue ? pushStringAttribute(target$jscomp$0, "href", "") : pushAttribute(target$jscomp$0, propKey, propValue);
							break;
						default: pushAttribute(target$jscomp$0, propKey, propValue);
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(endOfStartTag);
				pushInnerHTML(target$jscomp$0, innerHTML, children);
				if ("string" === typeof children) {
					target$jscomp$0.push(escapeTextForBrowser(children));
					var JSCompiler_inline_result = null;
				} else JSCompiler_inline_result = children;
				return JSCompiler_inline_result;
			case "g":
			case "p":
			case "li": break;
			case "select":
				target$jscomp$0.push(startChunkForTag("select"));
				var children$jscomp$0 = null, innerHTML$jscomp$0 = null, propKey$jscomp$0;
				for (propKey$jscomp$0 in props) if (hasOwnProperty.call(props, propKey$jscomp$0)) {
					var propValue$jscomp$0 = props[propKey$jscomp$0];
					if (null != propValue$jscomp$0) switch (propKey$jscomp$0) {
						case "children":
							children$jscomp$0 = propValue$jscomp$0;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$0 = propValue$jscomp$0;
							break;
						case "defaultValue":
						case "value": break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$0, propValue$jscomp$0);
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(endOfStartTag);
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$0, children$jscomp$0);
				return children$jscomp$0;
			case "option":
				var selectedValue = formatContext.selectedValue;
				target$jscomp$0.push(startChunkForTag("option"));
				var children$jscomp$1 = null, value = null, selected = null, innerHTML$jscomp$1 = null, propKey$jscomp$1;
				for (propKey$jscomp$1 in props) if (hasOwnProperty.call(props, propKey$jscomp$1)) {
					var propValue$jscomp$1 = props[propKey$jscomp$1];
					if (null != propValue$jscomp$1) switch (propKey$jscomp$1) {
						case "children":
							children$jscomp$1 = propValue$jscomp$1;
							break;
						case "selected":
							selected = propValue$jscomp$1;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$1 = propValue$jscomp$1;
							break;
						case "value": value = propValue$jscomp$1;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$1, propValue$jscomp$1);
					}
				}
				if (null != selectedValue) {
					var stringValue = null !== value ? "" + value : flattenOptionChildren(children$jscomp$1);
					if (isArrayImpl(selectedValue)) {
						for (var i = 0; i < selectedValue.length; i++) if ("" + selectedValue[i] === stringValue) {
							target$jscomp$0.push(selectedMarkerAttribute);
							break;
						}
					} else "" + selectedValue === stringValue && target$jscomp$0.push(selectedMarkerAttribute);
				} else selected && target$jscomp$0.push(selectedMarkerAttribute);
				target$jscomp$0.push(endOfStartTag);
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$1, children$jscomp$1);
				return children$jscomp$1;
			case "textarea":
				target$jscomp$0.push(startChunkForTag("textarea"));
				var value$jscomp$0 = null, defaultValue = null, children$jscomp$2 = null, propKey$jscomp$2;
				for (propKey$jscomp$2 in props) if (hasOwnProperty.call(props, propKey$jscomp$2)) {
					var propValue$jscomp$2 = props[propKey$jscomp$2];
					if (null != propValue$jscomp$2) switch (propKey$jscomp$2) {
						case "children":
							children$jscomp$2 = propValue$jscomp$2;
							break;
						case "value":
							value$jscomp$0 = propValue$jscomp$2;
							break;
						case "defaultValue":
							defaultValue = propValue$jscomp$2;
							break;
						case "dangerouslySetInnerHTML": throw Error("`dangerouslySetInnerHTML` does not make sense on <textarea>.");
						default: pushAttribute(target$jscomp$0, propKey$jscomp$2, propValue$jscomp$2);
					}
				}
				null === value$jscomp$0 && null !== defaultValue && (value$jscomp$0 = defaultValue);
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(endOfStartTag);
				if (null != children$jscomp$2) {
					if (null != value$jscomp$0) throw Error("If you supply `defaultValue` on a <textarea>, do not pass children.");
					if (isArrayImpl(children$jscomp$2)) {
						if (1 < children$jscomp$2.length) throw Error("<textarea> can only have at most one child.");
						value$jscomp$0 = "" + children$jscomp$2[0];
					}
					value$jscomp$0 = "" + children$jscomp$2;
				}
				"string" === typeof value$jscomp$0 && "\n" === value$jscomp$0[0] && target$jscomp$0.push(leadingNewline);
				null !== value$jscomp$0 && target$jscomp$0.push(escapeTextForBrowser("" + value$jscomp$0));
				return null;
			case "input":
				target$jscomp$0.push(startChunkForTag("input"));
				var name = null, formAction = null, formEncType = null, formMethod = null, formTarget = null, value$jscomp$1 = null, defaultValue$jscomp$0 = null, checked = null, defaultChecked = null, propKey$jscomp$3;
				for (propKey$jscomp$3 in props) if (hasOwnProperty.call(props, propKey$jscomp$3)) {
					var propValue$jscomp$3 = props[propKey$jscomp$3];
					if (null != propValue$jscomp$3) switch (propKey$jscomp$3) {
						case "children":
						case "dangerouslySetInnerHTML": throw Error("input is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.");
						case "name":
							name = propValue$jscomp$3;
							break;
						case "formAction":
							formAction = propValue$jscomp$3;
							break;
						case "formEncType":
							formEncType = propValue$jscomp$3;
							break;
						case "formMethod":
							formMethod = propValue$jscomp$3;
							break;
						case "formTarget":
							formTarget = propValue$jscomp$3;
							break;
						case "defaultChecked":
							defaultChecked = propValue$jscomp$3;
							break;
						case "defaultValue":
							defaultValue$jscomp$0 = propValue$jscomp$3;
							break;
						case "checked":
							checked = propValue$jscomp$3;
							break;
						case "value":
							value$jscomp$1 = propValue$jscomp$3;
							break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$3, propValue$jscomp$3);
					}
				}
				var formData = pushFormActionAttribute(target$jscomp$0, resumableState, renderState, formAction, formEncType, formMethod, formTarget, name);
				null !== checked ? pushBooleanAttribute(target$jscomp$0, "checked", checked) : null !== defaultChecked && pushBooleanAttribute(target$jscomp$0, "checked", defaultChecked);
				null !== value$jscomp$1 ? pushAttribute(target$jscomp$0, "value", value$jscomp$1) : null !== defaultValue$jscomp$0 && pushAttribute(target$jscomp$0, "value", defaultValue$jscomp$0);
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(endOfStartTagSelfClosing);
				formData?.forEach(pushAdditionalFormField, target$jscomp$0);
				return null;
			case "button":
				target$jscomp$0.push(startChunkForTag("button"));
				var children$jscomp$3 = null, innerHTML$jscomp$2 = null, name$jscomp$0 = null, formAction$jscomp$0 = null, formEncType$jscomp$0 = null, formMethod$jscomp$0 = null, formTarget$jscomp$0 = null, propKey$jscomp$4;
				for (propKey$jscomp$4 in props) if (hasOwnProperty.call(props, propKey$jscomp$4)) {
					var propValue$jscomp$4 = props[propKey$jscomp$4];
					if (null != propValue$jscomp$4) switch (propKey$jscomp$4) {
						case "children":
							children$jscomp$3 = propValue$jscomp$4;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$2 = propValue$jscomp$4;
							break;
						case "name":
							name$jscomp$0 = propValue$jscomp$4;
							break;
						case "formAction":
							formAction$jscomp$0 = propValue$jscomp$4;
							break;
						case "formEncType":
							formEncType$jscomp$0 = propValue$jscomp$4;
							break;
						case "formMethod":
							formMethod$jscomp$0 = propValue$jscomp$4;
							break;
						case "formTarget":
							formTarget$jscomp$0 = propValue$jscomp$4;
							break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$4, propValue$jscomp$4);
					}
				}
				var formData$jscomp$0 = pushFormActionAttribute(target$jscomp$0, resumableState, renderState, formAction$jscomp$0, formEncType$jscomp$0, formMethod$jscomp$0, formTarget$jscomp$0, name$jscomp$0);
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(endOfStartTag);
				formData$jscomp$0?.forEach(pushAdditionalFormField, target$jscomp$0);
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$2, children$jscomp$3);
				if ("string" === typeof children$jscomp$3) {
					target$jscomp$0.push(escapeTextForBrowser(children$jscomp$3));
					var JSCompiler_inline_result$jscomp$0 = null;
				} else JSCompiler_inline_result$jscomp$0 = children$jscomp$3;
				return JSCompiler_inline_result$jscomp$0;
			case "form":
				target$jscomp$0.push(startChunkForTag("form"));
				var children$jscomp$4 = null, innerHTML$jscomp$3 = null, formAction$jscomp$1 = null, formEncType$jscomp$1 = null, formMethod$jscomp$1 = null, formTarget$jscomp$1 = null, propKey$jscomp$5;
				for (propKey$jscomp$5 in props) if (hasOwnProperty.call(props, propKey$jscomp$5)) {
					var propValue$jscomp$5 = props[propKey$jscomp$5];
					if (null != propValue$jscomp$5) switch (propKey$jscomp$5) {
						case "children":
							children$jscomp$4 = propValue$jscomp$5;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$3 = propValue$jscomp$5;
							break;
						case "action":
							formAction$jscomp$1 = propValue$jscomp$5;
							break;
						case "encType":
							formEncType$jscomp$1 = propValue$jscomp$5;
							break;
						case "method":
							formMethod$jscomp$1 = propValue$jscomp$5;
							break;
						case "target":
							formTarget$jscomp$1 = propValue$jscomp$5;
							break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$5, propValue$jscomp$5);
					}
				}
				var formData$jscomp$1 = null, formActionName = null;
				if ("function" === typeof formAction$jscomp$1) {
					var customFields = getCustomFormFields(resumableState, formAction$jscomp$1);
					null !== customFields ? (formAction$jscomp$1 = customFields.action || "", formEncType$jscomp$1 = customFields.encType, formMethod$jscomp$1 = customFields.method, formTarget$jscomp$1 = customFields.target, formData$jscomp$1 = customFields.data, formActionName = customFields.name) : (target$jscomp$0.push(attributeSeparator, "action", attributeAssign, actionJavaScriptURL, attributeEnd), formTarget$jscomp$1 = formMethod$jscomp$1 = formEncType$jscomp$1 = formAction$jscomp$1 = null, injectFormReplayingRuntime(resumableState, renderState));
				}
				null != formAction$jscomp$1 && pushAttribute(target$jscomp$0, "action", formAction$jscomp$1);
				null != formEncType$jscomp$1 && pushAttribute(target$jscomp$0, "encType", formEncType$jscomp$1);
				null != formMethod$jscomp$1 && pushAttribute(target$jscomp$0, "method", formMethod$jscomp$1);
				null != formTarget$jscomp$1 && pushAttribute(target$jscomp$0, "target", formTarget$jscomp$1);
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(endOfStartTag);
				null !== formActionName && (target$jscomp$0.push(startHiddenInputChunk), pushStringAttribute(target$jscomp$0, "name", formActionName), target$jscomp$0.push(endOfStartTagSelfClosing), formData$jscomp$1?.forEach(pushAdditionalFormField, target$jscomp$0));
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$3, children$jscomp$4);
				if ("string" === typeof children$jscomp$4) {
					target$jscomp$0.push(escapeTextForBrowser(children$jscomp$4));
					var JSCompiler_inline_result$jscomp$1 = null;
				} else JSCompiler_inline_result$jscomp$1 = children$jscomp$4;
				return JSCompiler_inline_result$jscomp$1;
			case "menuitem":
				target$jscomp$0.push(startChunkForTag("menuitem"));
				for (var propKey$jscomp$6 in props) if (hasOwnProperty.call(props, propKey$jscomp$6)) {
					var propValue$jscomp$6 = props[propKey$jscomp$6];
					if (null != propValue$jscomp$6) switch (propKey$jscomp$6) {
						case "children":
						case "dangerouslySetInnerHTML": throw Error("menuitems cannot have `children` nor `dangerouslySetInnerHTML`.");
						default: pushAttribute(target$jscomp$0, propKey$jscomp$6, propValue$jscomp$6);
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(endOfStartTag);
				return null;
			case "object":
				target$jscomp$0.push(startChunkForTag("object"));
				var children$jscomp$5 = null, innerHTML$jscomp$4 = null, propKey$jscomp$7;
				for (propKey$jscomp$7 in props) if (hasOwnProperty.call(props, propKey$jscomp$7)) {
					var propValue$jscomp$7 = props[propKey$jscomp$7];
					if (null != propValue$jscomp$7) switch (propKey$jscomp$7) {
						case "children":
							children$jscomp$5 = propValue$jscomp$7;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$4 = propValue$jscomp$7;
							break;
						case "data":
							var sanitizedValue = sanitizeURL("" + propValue$jscomp$7);
							if ("" === sanitizedValue) break;
							target$jscomp$0.push(attributeSeparator, "data", attributeAssign, escapeTextForBrowser(sanitizedValue), attributeEnd);
							break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$7, propValue$jscomp$7);
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(endOfStartTag);
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$4, children$jscomp$5);
				if ("string" === typeof children$jscomp$5) {
					target$jscomp$0.push(escapeTextForBrowser(children$jscomp$5));
					var JSCompiler_inline_result$jscomp$2 = null;
				} else JSCompiler_inline_result$jscomp$2 = children$jscomp$5;
				return JSCompiler_inline_result$jscomp$2;
			case "title":
				var noscriptTagInScope = formatContext.tagScope & 1, isFallback = formatContext.tagScope & 4;
				if (4 === formatContext.insertionMode || noscriptTagInScope || null != props.itemProp) var JSCompiler_inline_result$jscomp$3 = pushTitleImpl(target$jscomp$0, props);
				else isFallback ? JSCompiler_inline_result$jscomp$3 = null : (pushTitleImpl(renderState.hoistableChunks, props), JSCompiler_inline_result$jscomp$3 = void 0);
				return JSCompiler_inline_result$jscomp$3;
			case "link":
				var noscriptTagInScope$jscomp$0 = formatContext.tagScope & 1, isFallback$jscomp$0 = formatContext.tagScope & 4, rel = props.rel, href = props.href, precedence = props.precedence;
				if (4 === formatContext.insertionMode || noscriptTagInScope$jscomp$0 || null != props.itemProp || "string" !== typeof rel || "string" !== typeof href || "" === href) {
					pushLinkImpl(target$jscomp$0, props);
					var JSCompiler_inline_result$jscomp$4 = null;
				} else if ("stylesheet" === props.rel) if ("string" !== typeof precedence || null != props.disabled || props.onLoad || props.onError) JSCompiler_inline_result$jscomp$4 = pushLinkImpl(target$jscomp$0, props);
				else {
					var styleQueue = renderState.styles.get(precedence), resourceState = resumableState.styleResources.hasOwnProperty(href) ? resumableState.styleResources[href] : void 0;
					if (null !== resourceState) {
						resumableState.styleResources[href] = null;
						styleQueue || (styleQueue = {
							precedence: escapeTextForBrowser(precedence),
							rules: [],
							hrefs: [],
							sheets: /* @__PURE__ */ new Map()
						}, renderState.styles.set(precedence, styleQueue));
						var resource = {
							state: 0,
							props: assign({}, props, {
								"data-precedence": props.precedence,
								precedence: null
							})
						};
						if (resourceState) {
							2 === resourceState.length && adoptPreloadCredentials(resource.props, resourceState);
							var preloadResource = renderState.preloads.stylesheets.get(href);
							preloadResource && 0 < preloadResource.length ? preloadResource.length = 0 : resource.state = 1;
						}
						styleQueue.sheets.set(href, resource);
						hoistableState && hoistableState.stylesheets.add(resource);
					} else if (styleQueue) {
						var resource$9 = styleQueue.sheets.get(href);
						resource$9 && hoistableState && hoistableState.stylesheets.add(resource$9);
					}
					textEmbedded && target$jscomp$0.push(textSeparator);
					JSCompiler_inline_result$jscomp$4 = null;
				}
				else props.onLoad || props.onError ? JSCompiler_inline_result$jscomp$4 = pushLinkImpl(target$jscomp$0, props) : (textEmbedded && target$jscomp$0.push(textSeparator), JSCompiler_inline_result$jscomp$4 = isFallback$jscomp$0 ? null : pushLinkImpl(renderState.hoistableChunks, props));
				return JSCompiler_inline_result$jscomp$4;
			case "script":
				var noscriptTagInScope$jscomp$1 = formatContext.tagScope & 1, asyncProp = props.async;
				if ("string" !== typeof props.src || !props.src || !asyncProp || "function" === typeof asyncProp || "symbol" === typeof asyncProp || props.onLoad || props.onError || 4 === formatContext.insertionMode || noscriptTagInScope$jscomp$1 || null != props.itemProp) var JSCompiler_inline_result$jscomp$5 = pushScriptImpl(target$jscomp$0, props);
				else {
					var key = props.src;
					if ("module" === props.type) {
						var resources = resumableState.moduleScriptResources;
						var preloads = renderState.preloads.moduleScripts;
					} else resources = resumableState.scriptResources, preloads = renderState.preloads.scripts;
					var resourceState$jscomp$0 = resources.hasOwnProperty(key) ? resources[key] : void 0;
					if (null !== resourceState$jscomp$0) {
						resources[key] = null;
						var scriptProps = props;
						if (resourceState$jscomp$0) {
							2 === resourceState$jscomp$0.length && (scriptProps = assign({}, props), adoptPreloadCredentials(scriptProps, resourceState$jscomp$0));
							var preloadResource$jscomp$0 = preloads.get(key);
							preloadResource$jscomp$0 && (preloadResource$jscomp$0.length = 0);
						}
						var resource$jscomp$0 = [];
						renderState.scripts.add(resource$jscomp$0);
						pushScriptImpl(resource$jscomp$0, scriptProps);
					}
					textEmbedded && target$jscomp$0.push(textSeparator);
					JSCompiler_inline_result$jscomp$5 = null;
				}
				return JSCompiler_inline_result$jscomp$5;
			case "style":
				var noscriptTagInScope$jscomp$2 = formatContext.tagScope & 1, precedence$jscomp$0 = props.precedence, href$jscomp$0 = props.href, nonce = props.nonce;
				if (4 === formatContext.insertionMode || noscriptTagInScope$jscomp$2 || null != props.itemProp || "string" !== typeof precedence$jscomp$0 || "string" !== typeof href$jscomp$0 || "" === href$jscomp$0) {
					target$jscomp$0.push(startChunkForTag("style"));
					var children$jscomp$6 = null, innerHTML$jscomp$5 = null, propKey$jscomp$8;
					for (propKey$jscomp$8 in props) if (hasOwnProperty.call(props, propKey$jscomp$8)) {
						var propValue$jscomp$8 = props[propKey$jscomp$8];
						if (null != propValue$jscomp$8) switch (propKey$jscomp$8) {
							case "children":
								children$jscomp$6 = propValue$jscomp$8;
								break;
							case "dangerouslySetInnerHTML":
								innerHTML$jscomp$5 = propValue$jscomp$8;
								break;
							default: pushAttribute(target$jscomp$0, propKey$jscomp$8, propValue$jscomp$8);
						}
					}
					target$jscomp$0.push(endOfStartTag);
					var child = Array.isArray(children$jscomp$6) ? 2 > children$jscomp$6.length ? children$jscomp$6[0] : null : children$jscomp$6;
					"function" !== typeof child && "symbol" !== typeof child && null !== child && void 0 !== child && target$jscomp$0.push(("" + child).replace(styleRegex, styleReplacer));
					pushInnerHTML(target$jscomp$0, innerHTML$jscomp$5, children$jscomp$6);
					target$jscomp$0.push(endChunkForTag("style"));
					var JSCompiler_inline_result$jscomp$6 = null;
				} else {
					var styleQueue$jscomp$0 = renderState.styles.get(precedence$jscomp$0);
					if (null !== (resumableState.styleResources.hasOwnProperty(href$jscomp$0) ? resumableState.styleResources[href$jscomp$0] : void 0)) {
						resumableState.styleResources[href$jscomp$0] = null;
						styleQueue$jscomp$0 || (styleQueue$jscomp$0 = {
							precedence: escapeTextForBrowser(precedence$jscomp$0),
							rules: [],
							hrefs: [],
							sheets: /* @__PURE__ */ new Map()
						}, renderState.styles.set(precedence$jscomp$0, styleQueue$jscomp$0));
						var nonceStyle = renderState.nonce.style;
						if (!nonceStyle || nonceStyle === nonce) {
							styleQueue$jscomp$0.hrefs.push(escapeTextForBrowser(href$jscomp$0));
							var target = styleQueue$jscomp$0.rules, children$jscomp$7 = null, innerHTML$jscomp$6 = null, propKey$jscomp$9;
							for (propKey$jscomp$9 in props) if (hasOwnProperty.call(props, propKey$jscomp$9)) {
								var propValue$jscomp$9 = props[propKey$jscomp$9];
								if (null != propValue$jscomp$9) switch (propKey$jscomp$9) {
									case "children":
										children$jscomp$7 = propValue$jscomp$9;
										break;
									case "dangerouslySetInnerHTML": innerHTML$jscomp$6 = propValue$jscomp$9;
								}
							}
							var child$jscomp$0 = Array.isArray(children$jscomp$7) ? 2 > children$jscomp$7.length ? children$jscomp$7[0] : null : children$jscomp$7;
							"function" !== typeof child$jscomp$0 && "symbol" !== typeof child$jscomp$0 && null !== child$jscomp$0 && void 0 !== child$jscomp$0 && target.push(("" + child$jscomp$0).replace(styleRegex, styleReplacer));
							pushInnerHTML(target, innerHTML$jscomp$6, children$jscomp$7);
						}
					}
					styleQueue$jscomp$0 && hoistableState && hoistableState.styles.add(styleQueue$jscomp$0);
					textEmbedded && target$jscomp$0.push(textSeparator);
					JSCompiler_inline_result$jscomp$6 = void 0;
				}
				return JSCompiler_inline_result$jscomp$6;
			case "meta":
				var noscriptTagInScope$jscomp$3 = formatContext.tagScope & 1, isFallback$jscomp$1 = formatContext.tagScope & 4;
				if (4 === formatContext.insertionMode || noscriptTagInScope$jscomp$3 || null != props.itemProp) var JSCompiler_inline_result$jscomp$7 = pushSelfClosing(target$jscomp$0, props, "meta", formatContext);
				else textEmbedded && target$jscomp$0.push(textSeparator), JSCompiler_inline_result$jscomp$7 = isFallback$jscomp$1 ? null : "string" === typeof props.charSet ? pushSelfClosing(renderState.charsetChunks, props, "meta", formatContext) : "viewport" === props.name ? pushSelfClosing(renderState.viewportChunks, props, "meta", formatContext) : pushSelfClosing(renderState.hoistableChunks, props, "meta", formatContext);
				return JSCompiler_inline_result$jscomp$7;
			case "listing":
			case "pre":
				target$jscomp$0.push(startChunkForTag(type));
				var children$jscomp$8 = null, innerHTML$jscomp$7 = null, propKey$jscomp$10;
				for (propKey$jscomp$10 in props) if (hasOwnProperty.call(props, propKey$jscomp$10)) {
					var propValue$jscomp$10 = props[propKey$jscomp$10];
					if (null != propValue$jscomp$10) switch (propKey$jscomp$10) {
						case "children":
							children$jscomp$8 = propValue$jscomp$10;
							break;
						case "dangerouslySetInnerHTML":
							innerHTML$jscomp$7 = propValue$jscomp$10;
							break;
						default: pushAttribute(target$jscomp$0, propKey$jscomp$10, propValue$jscomp$10);
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(endOfStartTag);
				if (null != innerHTML$jscomp$7) {
					if (null != children$jscomp$8) throw Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
					if ("object" !== typeof innerHTML$jscomp$7 || !("__html" in innerHTML$jscomp$7)) throw Error("`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://react.dev/link/dangerously-set-inner-html for more information.");
					var html = innerHTML$jscomp$7.__html;
					null !== html && void 0 !== html && ("string" === typeof html && 0 < html.length && "\n" === html[0] ? target$jscomp$0.push(leadingNewline, html) : target$jscomp$0.push("" + html));
				}
				"string" === typeof children$jscomp$8 && "\n" === children$jscomp$8[0] && target$jscomp$0.push(leadingNewline);
				return children$jscomp$8;
			case "img":
				var pictureOrNoScriptTagInScope = formatContext.tagScope & 3, src = props.src, srcSet = props.srcSet;
				if (!("lazy" === props.loading || !src && !srcSet || "string" !== typeof src && null != src || "string" !== typeof srcSet && null != srcSet || "low" === props.fetchPriority || pictureOrNoScriptTagInScope) && ("string" !== typeof src || ":" !== src[4] || "d" !== src[0] && "D" !== src[0] || "a" !== src[1] && "A" !== src[1] || "t" !== src[2] && "T" !== src[2] || "a" !== src[3] && "A" !== src[3]) && ("string" !== typeof srcSet || ":" !== srcSet[4] || "d" !== srcSet[0] && "D" !== srcSet[0] || "a" !== srcSet[1] && "A" !== srcSet[1] || "t" !== srcSet[2] && "T" !== srcSet[2] || "a" !== srcSet[3] && "A" !== srcSet[3])) {
					null !== hoistableState && formatContext.tagScope & 64 && (hoistableState.suspenseyImages = !0);
					var sizes = "string" === typeof props.sizes ? props.sizes : void 0, key$jscomp$0 = srcSet ? srcSet + "\n" + (sizes || "") : src, promotablePreloads = renderState.preloads.images, resource$jscomp$1 = promotablePreloads.get(key$jscomp$0);
					if (resource$jscomp$1) {
						if ("high" === props.fetchPriority || 10 > renderState.highImagePreloads.size) promotablePreloads.delete(key$jscomp$0), renderState.highImagePreloads.add(resource$jscomp$1);
					} else if (!resumableState.imageResources.hasOwnProperty(key$jscomp$0)) {
						resumableState.imageResources[key$jscomp$0] = PRELOAD_NO_CREDS;
						var input = props.crossOrigin;
						var JSCompiler_inline_result$jscomp$8 = "string" === typeof input ? "use-credentials" === input ? input : "" : void 0;
						var headers = renderState.headers, header;
						headers && 0 < headers.remainingCapacity && "string" !== typeof props.srcSet && ("high" === props.fetchPriority || 500 > headers.highImagePreloads.length) && (header = getPreloadAsHeader(src, "image", {
							imageSrcSet: props.srcSet,
							imageSizes: props.sizes,
							crossOrigin: JSCompiler_inline_result$jscomp$8,
							integrity: props.integrity,
							nonce: props.nonce,
							type: props.type,
							fetchPriority: props.fetchPriority,
							referrerPolicy: props.referrerPolicy
						}), 0 <= (headers.remainingCapacity -= header.length + 2)) ? (renderState.resets.image[key$jscomp$0] = PRELOAD_NO_CREDS, headers.highImagePreloads && (headers.highImagePreloads += ", "), headers.highImagePreloads += header) : (resource$jscomp$1 = [], pushLinkImpl(resource$jscomp$1, {
							rel: "preload",
							as: "image",
							href: srcSet ? void 0 : src,
							imageSrcSet: srcSet,
							imageSizes: sizes,
							crossOrigin: JSCompiler_inline_result$jscomp$8,
							integrity: props.integrity,
							type: props.type,
							fetchPriority: props.fetchPriority,
							referrerPolicy: props.referrerPolicy
						}), "high" === props.fetchPriority || 10 > renderState.highImagePreloads.size ? renderState.highImagePreloads.add(resource$jscomp$1) : (renderState.bulkPreloads.add(resource$jscomp$1), promotablePreloads.set(key$jscomp$0, resource$jscomp$1)));
					}
				}
				return pushSelfClosing(target$jscomp$0, props, "img", formatContext);
			case "base":
			case "area":
			case "br":
			case "col":
			case "embed":
			case "hr":
			case "keygen":
			case "param":
			case "source":
			case "track":
			case "wbr": return pushSelfClosing(target$jscomp$0, props, type, formatContext);
			case "annotation-xml":
			case "color-profile":
			case "font-face":
			case "font-face-src":
			case "font-face-uri":
			case "font-face-format":
			case "font-face-name":
			case "missing-glyph": break;
			case "head":
				if (2 > formatContext.insertionMode) {
					var preamble = preambleState || renderState.preamble;
					if (preamble.headChunks) throw Error("The `<head>` tag may only be rendered once.");
					null !== preambleState && target$jscomp$0.push(headPreambleContributionChunk);
					preamble.headChunks = [];
					var JSCompiler_inline_result$jscomp$9 = pushStartSingletonElement(preamble.headChunks, props, "head", formatContext);
				} else JSCompiler_inline_result$jscomp$9 = pushStartGenericElement(target$jscomp$0, props, "head", formatContext);
				return JSCompiler_inline_result$jscomp$9;
			case "body":
				if (2 > formatContext.insertionMode) {
					var preamble$jscomp$0 = preambleState || renderState.preamble;
					if (preamble$jscomp$0.bodyChunks) throw Error("The `<body>` tag may only be rendered once.");
					null !== preambleState && target$jscomp$0.push(bodyPreambleContributionChunk);
					preamble$jscomp$0.bodyChunks = [];
					var JSCompiler_inline_result$jscomp$10 = pushStartSingletonElement(preamble$jscomp$0.bodyChunks, props, "body", formatContext);
				} else JSCompiler_inline_result$jscomp$10 = pushStartGenericElement(target$jscomp$0, props, "body", formatContext);
				return JSCompiler_inline_result$jscomp$10;
			case "html":
				if (0 === formatContext.insertionMode) {
					var preamble$jscomp$1 = preambleState || renderState.preamble;
					if (preamble$jscomp$1.htmlChunks) throw Error("The `<html>` tag may only be rendered once.");
					null !== preambleState && target$jscomp$0.push(htmlPreambleContributionChunk);
					preamble$jscomp$1.htmlChunks = [doctypeChunk];
					var JSCompiler_inline_result$jscomp$11 = pushStartSingletonElement(preamble$jscomp$1.htmlChunks, props, "html", formatContext);
				} else JSCompiler_inline_result$jscomp$11 = pushStartGenericElement(target$jscomp$0, props, "html", formatContext);
				return JSCompiler_inline_result$jscomp$11;
			default: if (-1 !== type.indexOf("-")) {
				target$jscomp$0.push(startChunkForTag(type));
				var children$jscomp$9 = null, innerHTML$jscomp$8 = null, propKey$jscomp$11;
				for (propKey$jscomp$11 in props) if (hasOwnProperty.call(props, propKey$jscomp$11)) {
					var propValue$jscomp$11 = props[propKey$jscomp$11];
					if (null != propValue$jscomp$11) {
						var attributeName = propKey$jscomp$11;
						switch (propKey$jscomp$11) {
							case "children":
								children$jscomp$9 = propValue$jscomp$11;
								break;
							case "dangerouslySetInnerHTML":
								innerHTML$jscomp$8 = propValue$jscomp$11;
								break;
							case "style":
								pushStyleAttribute(target$jscomp$0, propValue$jscomp$11);
								break;
							case "suppressContentEditableWarning":
							case "suppressHydrationWarning":
							case "ref": break;
							case "className": attributeName = "class";
							default: if (isAttributeNameSafe(propKey$jscomp$11) && "function" !== typeof propValue$jscomp$11 && "symbol" !== typeof propValue$jscomp$11 && !1 !== propValue$jscomp$11) {
								if (!0 === propValue$jscomp$11) propValue$jscomp$11 = "";
								else if ("object" === typeof propValue$jscomp$11) continue;
								target$jscomp$0.push(attributeSeparator, attributeName, attributeAssign, escapeTextForBrowser(propValue$jscomp$11), attributeEnd);
							}
						}
					}
				}
				pushViewTransitionAttributes(target$jscomp$0, formatContext);
				target$jscomp$0.push(endOfStartTag);
				pushInnerHTML(target$jscomp$0, innerHTML$jscomp$8, children$jscomp$9);
				return children$jscomp$9;
			}
		}
		return pushStartGenericElement(target$jscomp$0, props, type, formatContext);
	}
	var endTagCache = /* @__PURE__ */ new Map();
	function endChunkForTag(tag) {
		var chunk = endTagCache.get(tag);
		void 0 === chunk && (chunk = stringToPrecomputedChunk("</" + tag + ">"), endTagCache.set(tag, chunk));
		return chunk;
	}
	function hoistPreambleState(renderState, preambleState) {
		renderState = renderState.preamble;
		null === renderState.htmlChunks && preambleState.htmlChunks && (renderState.htmlChunks = preambleState.htmlChunks);
		null === renderState.headChunks && preambleState.headChunks && (renderState.headChunks = preambleState.headChunks);
		null === renderState.bodyChunks && preambleState.bodyChunks && (renderState.bodyChunks = preambleState.bodyChunks);
	}
	function writeBootstrap(destination, renderState) {
		renderState = renderState.bootstrapChunks;
		for (var i = 0; i < renderState.length - 1; i++) writeChunk(destination, renderState[i]);
		return i < renderState.length ? (i = renderState[i], renderState.length = 0, writeChunkAndReturn(destination, i)) : !0;
	}
	var shellTimeRuntimeScript = stringToPrecomputedChunk("requestAnimationFrame(function(){$RT=performance.now()});");
	var placeholder1 = stringToPrecomputedChunk("<template id=\"");
	var placeholder2 = stringToPrecomputedChunk("\"></template>");
	var startActivityBoundary = stringToPrecomputedChunk("<!--&-->");
	var endActivityBoundary = stringToPrecomputedChunk("<!--/&-->");
	var startCompletedSuspenseBoundary = stringToPrecomputedChunk("<!--$-->");
	var startPendingSuspenseBoundary1 = stringToPrecomputedChunk("<!--$?--><template id=\"");
	var startPendingSuspenseBoundary2 = stringToPrecomputedChunk("\"></template>");
	var startClientRenderedSuspenseBoundary = stringToPrecomputedChunk("<!--$!-->");
	var endSuspenseBoundary = stringToPrecomputedChunk("<!--/$-->");
	var clientRenderedSuspenseBoundaryError1 = stringToPrecomputedChunk("<template");
	var clientRenderedSuspenseBoundaryErrorAttrInterstitial = stringToPrecomputedChunk("\"");
	var clientRenderedSuspenseBoundaryError1A = stringToPrecomputedChunk(" data-dgst=\"");
	stringToPrecomputedChunk(" data-msg=\"");
	stringToPrecomputedChunk(" data-stck=\"");
	stringToPrecomputedChunk(" data-cstck=\"");
	var clientRenderedSuspenseBoundaryError2 = stringToPrecomputedChunk("></template>");
	function writeStartPendingSuspenseBoundary(destination, renderState, id) {
		writeChunk(destination, startPendingSuspenseBoundary1);
		if (null === id) throw Error("An ID must have been assigned before we can complete the boundary.");
		writeChunk(destination, renderState.boundaryPrefix);
		writeChunk(destination, id.toString(16));
		return writeChunkAndReturn(destination, startPendingSuspenseBoundary2);
	}
	var startSegmentHTML = stringToPrecomputedChunk("<div hidden id=\"");
	var startSegmentHTML2 = stringToPrecomputedChunk("\">");
	var endSegmentHTML = stringToPrecomputedChunk("</div>");
	var startSegmentSVG = stringToPrecomputedChunk("<svg aria-hidden=\"true\" style=\"display:none\" id=\"");
	var startSegmentSVG2 = stringToPrecomputedChunk("\">");
	var endSegmentSVG = stringToPrecomputedChunk("</svg>");
	var startSegmentMathML = stringToPrecomputedChunk("<math aria-hidden=\"true\" style=\"display:none\" id=\"");
	var startSegmentMathML2 = stringToPrecomputedChunk("\">");
	var endSegmentMathML = stringToPrecomputedChunk("</math>");
	var startSegmentTable = stringToPrecomputedChunk("<table hidden id=\"");
	var startSegmentTable2 = stringToPrecomputedChunk("\">");
	var endSegmentTable = stringToPrecomputedChunk("</table>");
	var startSegmentTableBody = stringToPrecomputedChunk("<table hidden><tbody id=\"");
	var startSegmentTableBody2 = stringToPrecomputedChunk("\">");
	var endSegmentTableBody = stringToPrecomputedChunk("</tbody></table>");
	var startSegmentTableRow = stringToPrecomputedChunk("<table hidden><tr id=\"");
	var startSegmentTableRow2 = stringToPrecomputedChunk("\">");
	var endSegmentTableRow = stringToPrecomputedChunk("</tr></table>");
	var startSegmentColGroup = stringToPrecomputedChunk("<table hidden><colgroup id=\"");
	var startSegmentColGroup2 = stringToPrecomputedChunk("\">");
	var endSegmentColGroup = stringToPrecomputedChunk("</colgroup></table>");
	function writeStartSegment(destination, renderState, formatContext, id) {
		switch (formatContext.insertionMode) {
			case 0:
			case 1:
			case 3:
			case 2: return writeChunk(destination, startSegmentHTML), writeChunk(destination, renderState.segmentPrefix), writeChunk(destination, id.toString(16)), writeChunkAndReturn(destination, startSegmentHTML2);
			case 4: return writeChunk(destination, startSegmentSVG), writeChunk(destination, renderState.segmentPrefix), writeChunk(destination, id.toString(16)), writeChunkAndReturn(destination, startSegmentSVG2);
			case 5: return writeChunk(destination, startSegmentMathML), writeChunk(destination, renderState.segmentPrefix), writeChunk(destination, id.toString(16)), writeChunkAndReturn(destination, startSegmentMathML2);
			case 6: return writeChunk(destination, startSegmentTable), writeChunk(destination, renderState.segmentPrefix), writeChunk(destination, id.toString(16)), writeChunkAndReturn(destination, startSegmentTable2);
			case 7: return writeChunk(destination, startSegmentTableBody), writeChunk(destination, renderState.segmentPrefix), writeChunk(destination, id.toString(16)), writeChunkAndReturn(destination, startSegmentTableBody2);
			case 8: return writeChunk(destination, startSegmentTableRow), writeChunk(destination, renderState.segmentPrefix), writeChunk(destination, id.toString(16)), writeChunkAndReturn(destination, startSegmentTableRow2);
			case 9: return writeChunk(destination, startSegmentColGroup), writeChunk(destination, renderState.segmentPrefix), writeChunk(destination, id.toString(16)), writeChunkAndReturn(destination, startSegmentColGroup2);
			default: throw Error("Unknown insertion mode. This is a bug in React.");
		}
	}
	function writeEndSegment(destination, formatContext) {
		switch (formatContext.insertionMode) {
			case 0:
			case 1:
			case 3:
			case 2: return writeChunkAndReturn(destination, endSegmentHTML);
			case 4: return writeChunkAndReturn(destination, endSegmentSVG);
			case 5: return writeChunkAndReturn(destination, endSegmentMathML);
			case 6: return writeChunkAndReturn(destination, endSegmentTable);
			case 7: return writeChunkAndReturn(destination, endSegmentTableBody);
			case 8: return writeChunkAndReturn(destination, endSegmentTableRow);
			case 9: return writeChunkAndReturn(destination, endSegmentColGroup);
			default: throw Error("Unknown insertion mode. This is a bug in React.");
		}
	}
	var completeSegmentScript1Full = stringToPrecomputedChunk("$RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);b.parentNode.removeChild(b)};$RS(\"");
	var completeSegmentScript1Partial = stringToPrecomputedChunk("$RS(\"");
	var completeSegmentScript2 = stringToPrecomputedChunk("\",\"");
	var completeSegmentScriptEnd = stringToPrecomputedChunk("\")<\/script>");
	stringToPrecomputedChunk("<template data-rsi=\"\" data-sid=\"");
	stringToPrecomputedChunk("\" data-pid=\"");
	var completeBoundaryScriptFunctionOnly = stringToPrecomputedChunk("$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){var c=a[b],e=a[b+1];null!==e.parentNode&&e.parentNode.removeChild(e);var f=c.parentNode;if(f){var g=c.previousSibling,h=0;do{if(c&&8===c.nodeType){var d=c.data;if(\"/$\"===d||\"/&\"===d)if(0===h)break;else h--;else\"$\"!==d&&\"$?\"!==d&&\"$~\"!==d&&\"$!\"!==d&&\"&\"!==d||h++}d=c.nextSibling;f.removeChild(c);c=d}while(c);for(;e.firstChild;)f.insertBefore(e.firstChild,c);g.data=\"$\";g._reactRetry&&requestAnimationFrame(g._reactRetry)}}a.length=0};\n$RC=function(a,b){if(b=document.getElementById(b))(a=document.getElementById(a))?(a.previousSibling.data=\"$~\",$RB.push(a,b),2===$RB.length&&(\"number\"!==typeof $RT?requestAnimationFrame($RV.bind(null,$RB)):(a=performance.now(),setTimeout($RV.bind(null,$RB),2300>a&&2E3<a?2300-a:$RT+300-a)))):b.parentNode.removeChild(b)};");
	var completeBoundaryScript1Partial = stringToPrecomputedChunk("$RC(\"");
	var completeBoundaryWithStylesScript1FullPartial = stringToPrecomputedChunk("$RM=new Map;$RR=function(n,w,p){function u(q){this._p=null;q()}for(var r=new Map,t=document,h,b,e=t.querySelectorAll(\"link[data-precedence],style[data-precedence]\"),v=[],k=0;b=e[k++];)\"not all\"===b.getAttribute(\"media\")?v.push(b):(\"LINK\"===b.tagName&&$RM.set(b.getAttribute(\"href\"),b),r.set(b.dataset.precedence,h=b));e=0;b=[];var l,a;for(k=!0;;){if(k){var f=p[e++];if(!f){k=!1;e=0;continue}var c=!1,m=0;var d=f[m++];if(a=$RM.get(d)){var g=a._p;c=!0}else{a=t.createElement(\"link\");a.href=d;a.rel=\n\"stylesheet\";for(a.dataset.precedence=l=f[m++];g=f[m++];)a.setAttribute(g,f[m++]);g=a._p=new Promise(function(q,x){a.onload=u.bind(a,q);a.onerror=u.bind(a,x)});$RM.set(d,a)}d=a.getAttribute(\"media\");!g||d&&!matchMedia(d).matches||b.push(g);if(c)continue}else{a=v[e++];if(!a)break;l=a.getAttribute(\"data-precedence\");a.removeAttribute(\"media\")}c=r.get(l)||h;c===h&&(h=a);r.set(l,a);c?c.parentNode.insertBefore(a,c.nextSibling):(c=t.head,c.insertBefore(a,c.firstChild))}if(p=document.getElementById(n))p.previousSibling.data=\n\"$~\";Promise.all(b).then($RC.bind(null,n,w),$RX.bind(null,n,\"CSS failed to load\"))};$RR(\"");
	var completeBoundaryWithStylesScript1Partial = stringToPrecomputedChunk("$RR(\"");
	var completeBoundaryScript2 = stringToPrecomputedChunk("\",\"");
	var completeBoundaryScript3a = stringToPrecomputedChunk("\",");
	var completeBoundaryScript3b = stringToPrecomputedChunk("\"");
	var completeBoundaryScriptEnd = stringToPrecomputedChunk(")<\/script>");
	stringToPrecomputedChunk("<template data-rci=\"\" data-bid=\"");
	stringToPrecomputedChunk("<template data-rri=\"\" data-bid=\"");
	stringToPrecomputedChunk("\" data-sid=\"");
	stringToPrecomputedChunk("\" data-sty=\"");
	var clientRenderScriptFunctionOnly = stringToPrecomputedChunk("$RX=function(b,c,d,e,f){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data=\"$!\",a=a.dataset,null!=c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),f&&(a.cstck=f),b._reactRetry&&b._reactRetry())};");
	var clientRenderScript1Full = stringToPrecomputedChunk("$RX=function(b,c,d,e,f){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data=\"$!\",a=a.dataset,null!=c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),f&&(a.cstck=f),b._reactRetry&&b._reactRetry())};;$RX(\"");
	var clientRenderScript1Partial = stringToPrecomputedChunk("$RX(\"");
	var clientRenderScript1A = stringToPrecomputedChunk("\"");
	var clientRenderErrorScriptArgInterstitial = stringToPrecomputedChunk(",");
	var clientRenderErrorScriptNull = stringToPrecomputedChunk("null");
	var clientRenderScriptEnd = stringToPrecomputedChunk(")<\/script>");
	stringToPrecomputedChunk("<template data-rxi=\"\" data-bid=\"");
	stringToPrecomputedChunk("\" data-dgst=\"");
	stringToPrecomputedChunk("\" data-msg=\"");
	stringToPrecomputedChunk("\" data-stck=\"");
	stringToPrecomputedChunk("\" data-cstck=\"");
	var regexForJSStringsInInstructionScripts = /[<\u2028\u2029]/g;
	function escapeJSStringsForInstructionScripts(input) {
		return JSON.stringify(input).replace(regexForJSStringsInInstructionScripts, function(match) {
			switch (match) {
				case "<": return "\\u003c";
				case "\u2028": return "\\u2028";
				case "\u2029": return "\\u2029";
				default: throw Error("escapeJSStringsForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React");
			}
		});
	}
	var regexForJSStringsInScripts = /[&><\u2028\u2029]/g;
	function escapeJSObjectForInstructionScripts(input) {
		return JSON.stringify(input).replace(regexForJSStringsInScripts, function(match) {
			switch (match) {
				case "&": return "\\u0026";
				case ">": return "\\u003e";
				case "<": return "\\u003c";
				case "\u2028": return "\\u2028";
				case "\u2029": return "\\u2029";
				default: throw Error("escapeJSObjectForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React");
			}
		});
	}
	var lateStyleTagResourceOpen1 = stringToPrecomputedChunk(" media=\"not all\" data-precedence=\"");
	var lateStyleTagResourceOpen2 = stringToPrecomputedChunk("\" data-href=\"");
	var lateStyleTagResourceOpen3 = stringToPrecomputedChunk("\">");
	var lateStyleTagTemplateClose = stringToPrecomputedChunk("</style>");
	var currentlyRenderingBoundaryHasStylesToHoist = !1;
	var destinationHasCapacity = !0;
	function flushStyleTagsLateForBoundary(styleQueue) {
		var rules = styleQueue.rules, hrefs = styleQueue.hrefs, i = 0;
		if (hrefs.length) {
			writeChunk(this, currentlyFlushingRenderState.startInlineStyle);
			writeChunk(this, lateStyleTagResourceOpen1);
			writeChunk(this, styleQueue.precedence);
			for (writeChunk(this, lateStyleTagResourceOpen2); i < hrefs.length - 1; i++) writeChunk(this, hrefs[i]), writeChunk(this, spaceSeparator);
			writeChunk(this, hrefs[i]);
			writeChunk(this, lateStyleTagResourceOpen3);
			for (i = 0; i < rules.length; i++) writeChunk(this, rules[i]);
			destinationHasCapacity = writeChunkAndReturn(this, lateStyleTagTemplateClose);
			currentlyRenderingBoundaryHasStylesToHoist = !0;
			rules.length = 0;
			hrefs.length = 0;
		}
	}
	function hasStylesToHoist(stylesheet) {
		return 2 !== stylesheet.state ? currentlyRenderingBoundaryHasStylesToHoist = !0 : !1;
	}
	function writeHoistablesForBoundary(destination, hoistableState, renderState) {
		currentlyRenderingBoundaryHasStylesToHoist = !1;
		destinationHasCapacity = !0;
		currentlyFlushingRenderState = renderState;
		hoistableState.styles.forEach(flushStyleTagsLateForBoundary, destination);
		currentlyFlushingRenderState = null;
		hoistableState.stylesheets.forEach(hasStylesToHoist);
		currentlyRenderingBoundaryHasStylesToHoist && (renderState.stylesToHoist = !0);
		return destinationHasCapacity;
	}
	function flushResource(resource) {
		for (var i = 0; i < resource.length; i++) writeChunk(this, resource[i]);
		resource.length = 0;
	}
	var stylesheetFlushingQueue = [];
	function flushStyleInPreamble(stylesheet) {
		pushLinkImpl(stylesheetFlushingQueue, stylesheet.props);
		for (var i = 0; i < stylesheetFlushingQueue.length; i++) writeChunk(this, stylesheetFlushingQueue[i]);
		stylesheetFlushingQueue.length = 0;
		stylesheet.state = 2;
	}
	var styleTagResourceOpen1 = stringToPrecomputedChunk(" data-precedence=\"");
	var styleTagResourceOpen2 = stringToPrecomputedChunk("\" data-href=\"");
	var spaceSeparator = stringToPrecomputedChunk(" ");
	var styleTagResourceOpen3 = stringToPrecomputedChunk("\">");
	var styleTagResourceClose = stringToPrecomputedChunk("</style>");
	function flushStylesInPreamble(styleQueue) {
		var hasStylesheets = 0 < styleQueue.sheets.size;
		styleQueue.sheets.forEach(flushStyleInPreamble, this);
		styleQueue.sheets.clear();
		var rules = styleQueue.rules, hrefs = styleQueue.hrefs;
		if (!hasStylesheets || hrefs.length) {
			writeChunk(this, currentlyFlushingRenderState.startInlineStyle);
			writeChunk(this, styleTagResourceOpen1);
			writeChunk(this, styleQueue.precedence);
			styleQueue = 0;
			if (hrefs.length) {
				for (writeChunk(this, styleTagResourceOpen2); styleQueue < hrefs.length - 1; styleQueue++) writeChunk(this, hrefs[styleQueue]), writeChunk(this, spaceSeparator);
				writeChunk(this, hrefs[styleQueue]);
			}
			writeChunk(this, styleTagResourceOpen3);
			for (styleQueue = 0; styleQueue < rules.length; styleQueue++) writeChunk(this, rules[styleQueue]);
			writeChunk(this, styleTagResourceClose);
			rules.length = 0;
			hrefs.length = 0;
		}
	}
	function preloadLateStyle(stylesheet) {
		if (0 === stylesheet.state) {
			stylesheet.state = 1;
			var props = stylesheet.props;
			pushLinkImpl(stylesheetFlushingQueue, {
				rel: "preload",
				as: "style",
				href: stylesheet.props.href,
				crossOrigin: props.crossOrigin,
				fetchPriority: props.fetchPriority,
				integrity: props.integrity,
				media: props.media,
				hrefLang: props.hrefLang,
				referrerPolicy: props.referrerPolicy
			});
			for (stylesheet = 0; stylesheet < stylesheetFlushingQueue.length; stylesheet++) writeChunk(this, stylesheetFlushingQueue[stylesheet]);
			stylesheetFlushingQueue.length = 0;
		}
	}
	function preloadLateStyles(styleQueue) {
		styleQueue.sheets.forEach(preloadLateStyle, this);
		styleQueue.sheets.clear();
	}
	stringToPrecomputedChunk("<link rel=\"expect\" href=\"#");
	stringToPrecomputedChunk("\" blocking=\"render\"/>");
	var completedShellIdAttributeStart = stringToPrecomputedChunk(" id=\"");
	function pushCompletedShellIdAttribute(target, resumableState) {
		0 === (resumableState.instructions & 32) && (resumableState.instructions |= 32, target.push(completedShellIdAttributeStart, escapeTextForBrowser("_" + resumableState.idPrefix + "R_"), attributeEnd));
	}
	var arrayFirstOpenBracket = stringToPrecomputedChunk("[");
	var arraySubsequentOpenBracket = stringToPrecomputedChunk(",[");
	var arrayInterstitial = stringToPrecomputedChunk(",");
	var arrayCloseBracket = stringToPrecomputedChunk("]");
	function writeStyleResourceDependenciesInJS(destination, hoistableState) {
		writeChunk(destination, arrayFirstOpenBracket);
		var nextArrayOpenBrackChunk = arrayFirstOpenBracket;
		hoistableState.stylesheets.forEach(function(resource) {
			if (2 !== resource.state) if (3 === resource.state) writeChunk(destination, nextArrayOpenBrackChunk), writeChunk(destination, escapeJSObjectForInstructionScripts("" + resource.props.href)), writeChunk(destination, arrayCloseBracket), nextArrayOpenBrackChunk = arraySubsequentOpenBracket;
			else {
				writeChunk(destination, nextArrayOpenBrackChunk);
				var precedence = resource.props["data-precedence"], props = resource.props;
				writeChunk(destination, escapeJSObjectForInstructionScripts(sanitizeURL("" + resource.props.href)));
				precedence = "" + precedence;
				writeChunk(destination, arrayInterstitial);
				writeChunk(destination, escapeJSObjectForInstructionScripts(precedence));
				for (var propKey in props) if (hasOwnProperty.call(props, propKey) && (precedence = props[propKey], null != precedence)) switch (propKey) {
					case "href":
					case "rel":
					case "precedence":
					case "data-precedence": break;
					case "children":
					case "dangerouslySetInnerHTML": throw Error("link is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.");
					default: writeStyleResourceAttributeInJS(destination, propKey, precedence);
				}
				writeChunk(destination, arrayCloseBracket);
				nextArrayOpenBrackChunk = arraySubsequentOpenBracket;
				resource.state = 3;
			}
		});
		writeChunk(destination, arrayCloseBracket);
	}
	function writeStyleResourceAttributeInJS(destination, name, value) {
		var attributeName = name.toLowerCase();
		switch (typeof value) {
			case "function":
			case "symbol": return;
		}
		switch (name) {
			case "innerHTML":
			case "dangerouslySetInnerHTML":
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "style":
			case "ref": return;
			case "className":
				attributeName = "class";
				name = "" + value;
				break;
			case "hidden":
				if (!1 === value) return;
				name = "";
				break;
			case "src":
			case "href":
				value = sanitizeURL(value);
				name = "" + value;
				break;
			default:
				if (2 < name.length && ("o" === name[0] || "O" === name[0]) && ("n" === name[1] || "N" === name[1]) || !isAttributeNameSafe(name)) return;
				name = "" + value;
		}
		writeChunk(destination, arrayInterstitial);
		writeChunk(destination, escapeJSObjectForInstructionScripts(attributeName));
		writeChunk(destination, arrayInterstitial);
		writeChunk(destination, escapeJSObjectForInstructionScripts(name));
	}
	function createHoistableState() {
		return {
			styles: /* @__PURE__ */ new Set(),
			stylesheets: /* @__PURE__ */ new Set(),
			suspenseyImages: !1
		};
	}
	function prefetchDNS(href) {
		var request = resolveRequest();
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if ("string" === typeof href && href) {
				if (!resumableState.dnsResources.hasOwnProperty(href)) {
					resumableState.dnsResources[href] = null;
					resumableState = renderState.headers;
					var header, JSCompiler_temp;
					if (JSCompiler_temp = resumableState && 0 < resumableState.remainingCapacity) JSCompiler_temp = (header = "<" + ("" + href).replace(regexForHrefInLinkHeaderURLContext, escapeHrefForLinkHeaderURLContextReplacer) + ">; rel=dns-prefetch", 0 <= (resumableState.remainingCapacity -= header.length + 2));
					JSCompiler_temp ? (renderState.resets.dns[href] = null, resumableState.preconnects && (resumableState.preconnects += ", "), resumableState.preconnects += header) : (header = [], pushLinkImpl(header, {
						href,
						rel: "dns-prefetch"
					}), renderState.preconnects.add(header));
				}
				enqueueFlush(request);
			}
		} else previousDispatcher.D(href);
	}
	function preconnect(href, crossOrigin) {
		var request = resolveRequest();
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if ("string" === typeof href && href) {
				var bucket = "use-credentials" === crossOrigin ? "credentials" : "string" === typeof crossOrigin ? "anonymous" : "default";
				if (!resumableState.connectResources[bucket].hasOwnProperty(href)) {
					resumableState.connectResources[bucket][href] = null;
					resumableState = renderState.headers;
					var header, JSCompiler_temp;
					if (JSCompiler_temp = resumableState && 0 < resumableState.remainingCapacity) {
						JSCompiler_temp = "<" + ("" + href).replace(regexForHrefInLinkHeaderURLContext, escapeHrefForLinkHeaderURLContextReplacer) + ">; rel=preconnect";
						if ("string" === typeof crossOrigin) {
							var escapedCrossOrigin = ("" + crossOrigin).replace(regexForLinkHeaderQuotedParamValueContext, escapeStringForLinkHeaderQuotedParamValueContextReplacer);
							JSCompiler_temp += "; crossorigin=\"" + escapedCrossOrigin + "\"";
						}
						JSCompiler_temp = (header = JSCompiler_temp, 0 <= (resumableState.remainingCapacity -= header.length + 2));
					}
					JSCompiler_temp ? (renderState.resets.connect[bucket][href] = null, resumableState.preconnects && (resumableState.preconnects += ", "), resumableState.preconnects += header) : (bucket = [], pushLinkImpl(bucket, {
						rel: "preconnect",
						href,
						crossOrigin
					}), renderState.preconnects.add(bucket));
				}
				enqueueFlush(request);
			}
		} else previousDispatcher.C(href, crossOrigin);
	}
	function preload(href, as, options) {
		var request = resolveRequest();
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if (as && href) {
				switch (as) {
					case "image":
						if (options) {
							var imageSrcSet = options.imageSrcSet;
							var imageSizes = options.imageSizes;
							var fetchPriority = options.fetchPriority;
						}
						var key = imageSrcSet ? imageSrcSet + "\n" + (imageSizes || "") : href;
						if (resumableState.imageResources.hasOwnProperty(key)) return;
						resumableState.imageResources[key] = PRELOAD_NO_CREDS;
						resumableState = renderState.headers;
						var header;
						resumableState && 0 < resumableState.remainingCapacity && "string" !== typeof imageSrcSet && "high" === fetchPriority && (header = getPreloadAsHeader(href, as, options), 0 <= (resumableState.remainingCapacity -= header.length + 2)) ? (renderState.resets.image[key] = PRELOAD_NO_CREDS, resumableState.highImagePreloads && (resumableState.highImagePreloads += ", "), resumableState.highImagePreloads += header) : (resumableState = [], pushLinkImpl(resumableState, assign({
							rel: "preload",
							href: imageSrcSet ? void 0 : href,
							as
						}, options)), "high" === fetchPriority ? renderState.highImagePreloads.add(resumableState) : (renderState.bulkPreloads.add(resumableState), renderState.preloads.images.set(key, resumableState)));
						break;
					case "style":
						if (resumableState.styleResources.hasOwnProperty(href)) return;
						imageSrcSet = [];
						pushLinkImpl(imageSrcSet, assign({
							rel: "preload",
							href,
							as
						}, options));
						resumableState.styleResources[href] = !options || "string" !== typeof options.crossOrigin && "string" !== typeof options.integrity ? PRELOAD_NO_CREDS : [options.crossOrigin, options.integrity];
						renderState.preloads.stylesheets.set(href, imageSrcSet);
						renderState.bulkPreloads.add(imageSrcSet);
						break;
					case "script":
						if (resumableState.scriptResources.hasOwnProperty(href)) return;
						imageSrcSet = [];
						renderState.preloads.scripts.set(href, imageSrcSet);
						renderState.bulkPreloads.add(imageSrcSet);
						pushLinkImpl(imageSrcSet, assign({
							rel: "preload",
							href,
							as
						}, options));
						resumableState.scriptResources[href] = !options || "string" !== typeof options.crossOrigin && "string" !== typeof options.integrity ? PRELOAD_NO_CREDS : [options.crossOrigin, options.integrity];
						break;
					default:
						if (resumableState.unknownResources.hasOwnProperty(as)) {
							if (imageSrcSet = resumableState.unknownResources[as], imageSrcSet.hasOwnProperty(href)) return;
						} else imageSrcSet = {}, resumableState.unknownResources[as] = imageSrcSet;
						imageSrcSet[href] = PRELOAD_NO_CREDS;
						if ((resumableState = renderState.headers) && 0 < resumableState.remainingCapacity && "font" === as && (key = getPreloadAsHeader(href, as, options), 0 <= (resumableState.remainingCapacity -= key.length + 2))) renderState.resets.font[href] = PRELOAD_NO_CREDS, resumableState.fontPreloads && (resumableState.fontPreloads += ", "), resumableState.fontPreloads += key;
						else switch (resumableState = [], href = assign({
							rel: "preload",
							href,
							as
						}, options), pushLinkImpl(resumableState, href), as) {
							case "font":
								renderState.fontPreloads.add(resumableState);
								break;
							default: renderState.bulkPreloads.add(resumableState);
						}
				}
				enqueueFlush(request);
			}
		} else previousDispatcher.L(href, as, options);
	}
	function preloadModule(href, options) {
		var request = resolveRequest();
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if (href) {
				var as = options && "string" === typeof options.as ? options.as : "script";
				switch (as) {
					case "script":
						if (resumableState.moduleScriptResources.hasOwnProperty(href)) return;
						as = [];
						resumableState.moduleScriptResources[href] = !options || "string" !== typeof options.crossOrigin && "string" !== typeof options.integrity ? PRELOAD_NO_CREDS : [options.crossOrigin, options.integrity];
						renderState.preloads.moduleScripts.set(href, as);
						break;
					default:
						if (resumableState.moduleUnknownResources.hasOwnProperty(as)) {
							var resources = resumableState.moduleUnknownResources[as];
							if (resources.hasOwnProperty(href)) return;
						} else resources = {}, resumableState.moduleUnknownResources[as] = resources;
						as = [];
						resources[href] = PRELOAD_NO_CREDS;
				}
				pushLinkImpl(as, assign({
					rel: "modulepreload",
					href
				}, options));
				renderState.bulkPreloads.add(as);
				enqueueFlush(request);
			}
		} else previousDispatcher.m(href, options);
	}
	function preinitStyle(href, precedence, options) {
		var request = resolveRequest();
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if (href) {
				precedence = precedence || "default";
				var styleQueue = renderState.styles.get(precedence), resourceState = resumableState.styleResources.hasOwnProperty(href) ? resumableState.styleResources[href] : void 0;
				null !== resourceState && (resumableState.styleResources[href] = null, styleQueue || (styleQueue = {
					precedence: escapeTextForBrowser(precedence),
					rules: [],
					hrefs: [],
					sheets: /* @__PURE__ */ new Map()
				}, renderState.styles.set(precedence, styleQueue)), precedence = {
					state: 0,
					props: assign({
						rel: "stylesheet",
						href,
						"data-precedence": precedence
					}, options)
				}, resourceState && (2 === resourceState.length && adoptPreloadCredentials(precedence.props, resourceState), (renderState = renderState.preloads.stylesheets.get(href)) && 0 < renderState.length ? renderState.length = 0 : precedence.state = 1), styleQueue.sheets.set(href, precedence), enqueueFlush(request));
			}
		} else previousDispatcher.S(href, precedence, options);
	}
	function preinitScript(src, options) {
		var request = resolveRequest();
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if (src) {
				var resourceState = resumableState.scriptResources.hasOwnProperty(src) ? resumableState.scriptResources[src] : void 0;
				null !== resourceState && (resumableState.scriptResources[src] = null, options = assign({
					src,
					async: !0
				}, options), resourceState && (2 === resourceState.length && adoptPreloadCredentials(options, resourceState), src = renderState.preloads.scripts.get(src)) && (src.length = 0), src = [], renderState.scripts.add(src), pushScriptImpl(src, options), enqueueFlush(request));
			}
		} else previousDispatcher.X(src, options);
	}
	function preinitModuleScript(src, options) {
		var request = resolveRequest();
		if (request) {
			var resumableState = request.resumableState, renderState = request.renderState;
			if (src) {
				var resourceState = resumableState.moduleScriptResources.hasOwnProperty(src) ? resumableState.moduleScriptResources[src] : void 0;
				null !== resourceState && (resumableState.moduleScriptResources[src] = null, options = assign({
					src,
					type: "module",
					async: !0
				}, options), resourceState && (2 === resourceState.length && adoptPreloadCredentials(options, resourceState), src = renderState.preloads.moduleScripts.get(src)) && (src.length = 0), src = [], renderState.scripts.add(src), pushScriptImpl(src, options), enqueueFlush(request));
			}
		} else previousDispatcher.M(src, options);
	}
	function adoptPreloadCredentials(target, preloadState) {
		target.crossOrigin ??= preloadState[0];
		target.integrity ??= preloadState[1];
	}
	function getPreloadAsHeader(href, as, params) {
		href = ("" + href).replace(regexForHrefInLinkHeaderURLContext, escapeHrefForLinkHeaderURLContextReplacer);
		as = ("" + as).replace(regexForLinkHeaderQuotedParamValueContext, escapeStringForLinkHeaderQuotedParamValueContextReplacer);
		as = "<" + href + ">; rel=preload; as=\"" + as + "\"";
		for (var paramName in params) hasOwnProperty.call(params, paramName) && (href = params[paramName], "string" === typeof href && (as += "; " + paramName.toLowerCase() + "=\"" + ("" + href).replace(regexForLinkHeaderQuotedParamValueContext, escapeStringForLinkHeaderQuotedParamValueContextReplacer) + "\""));
		return as;
	}
	var regexForHrefInLinkHeaderURLContext = /[<>\r\n]/g;
	function escapeHrefForLinkHeaderURLContextReplacer(match) {
		switch (match) {
			case "<": return "%3C";
			case ">": return "%3E";
			case "\n": return "%0A";
			case "\r": return "%0D";
			default: throw Error("escapeLinkHrefForHeaderContextReplacer encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React");
		}
	}
	var regexForLinkHeaderQuotedParamValueContext = /["';,\r\n]/g;
	function escapeStringForLinkHeaderQuotedParamValueContextReplacer(match) {
		switch (match) {
			case "\"": return "%22";
			case "'": return "%27";
			case ";": return "%3B";
			case ",": return "%2C";
			case "\n": return "%0A";
			case "\r": return "%0D";
			default: throw Error("escapeStringForLinkHeaderQuotedParamValueContextReplacer encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React");
		}
	}
	function hoistStyleQueueDependency(styleQueue) {
		this.styles.add(styleQueue);
	}
	function hoistStylesheetDependency(stylesheet) {
		this.stylesheets.add(stylesheet);
	}
	function hoistHoistables(parentState, childState) {
		childState.styles.forEach(hoistStyleQueueDependency, parentState);
		childState.stylesheets.forEach(hoistStylesheetDependency, parentState);
		childState.suspenseyImages && (parentState.suspenseyImages = !0);
	}
	function hasSuspenseyContent(hoistableState, flushingInShell) {
		return flushingInShell ? hoistableState.suspenseyImages : 0 < hoistableState.stylesheets.size || hoistableState.suspenseyImages;
	}
	var bind = Function.prototype.bind;
	var requestStorage = new async_hooks.AsyncLocalStorage();
	var REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference");
	function getComponentNameFromType(type) {
		if (null == type) return null;
		if ("function" === typeof type) return type.$$typeof === REACT_CLIENT_REFERENCE ? null : type.displayName || type.name || null;
		if ("string" === typeof type) return type;
		switch (type) {
			case REACT_FRAGMENT_TYPE: return "Fragment";
			case REACT_PROFILER_TYPE: return "Profiler";
			case REACT_STRICT_MODE_TYPE: return "StrictMode";
			case REACT_SUSPENSE_TYPE: return "Suspense";
			case REACT_SUSPENSE_LIST_TYPE: return "SuspenseList";
			case REACT_ACTIVITY_TYPE: return "Activity";
			case REACT_VIEW_TRANSITION_TYPE: return "ViewTransition";
		}
		if ("object" === typeof type) switch (type.$$typeof) {
			case REACT_PORTAL_TYPE: return "Portal";
			case REACT_CONTEXT_TYPE: return type.displayName || "Context";
			case REACT_CONSUMER_TYPE: return (type._context.displayName || "Context") + ".Consumer";
			case REACT_FORWARD_REF_TYPE:
				var innerType = type.render;
				type = type.displayName;
				type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
				return type;
			case REACT_MEMO_TYPE: return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
			case REACT_LAZY_TYPE:
				innerType = type._payload;
				type = type._init;
				try {
					return getComponentNameFromType(type(innerType));
				} catch (x) {}
		}
		return null;
	}
	var emptyContextObject = {};
	var currentActiveSnapshot = null;
	function popToNearestCommonAncestor(prev, next) {
		if (prev !== next) {
			prev.context._currentValue = prev.parentValue;
			prev = prev.parent;
			var parentNext = next.parent;
			if (null === prev) {
				if (null !== parentNext) throw Error("The stacks must reach the root at the same time. This is a bug in React.");
			} else {
				if (null === parentNext) throw Error("The stacks must reach the root at the same time. This is a bug in React.");
				popToNearestCommonAncestor(prev, parentNext);
			}
			next.context._currentValue = next.value;
		}
	}
	function popAllPrevious(prev) {
		prev.context._currentValue = prev.parentValue;
		prev = prev.parent;
		null !== prev && popAllPrevious(prev);
	}
	function pushAllNext(next) {
		var parentNext = next.parent;
		null !== parentNext && pushAllNext(parentNext);
		next.context._currentValue = next.value;
	}
	function popPreviousToCommonLevel(prev, next) {
		prev.context._currentValue = prev.parentValue;
		prev = prev.parent;
		if (null === prev) throw Error("The depth must equal at least at zero before reaching the root. This is a bug in React.");
		prev.depth === next.depth ? popToNearestCommonAncestor(prev, next) : popPreviousToCommonLevel(prev, next);
	}
	function popNextToCommonLevel(prev, next) {
		var parentNext = next.parent;
		if (null === parentNext) throw Error("The depth must equal at least at zero before reaching the root. This is a bug in React.");
		prev.depth === parentNext.depth ? popToNearestCommonAncestor(prev, parentNext) : popNextToCommonLevel(prev, parentNext);
		next.context._currentValue = next.value;
	}
	function switchContext(newSnapshot) {
		var prev = currentActiveSnapshot;
		prev !== newSnapshot && (null === prev ? pushAllNext(newSnapshot) : null === newSnapshot ? popAllPrevious(prev) : prev.depth === newSnapshot.depth ? popToNearestCommonAncestor(prev, newSnapshot) : prev.depth > newSnapshot.depth ? popPreviousToCommonLevel(prev, newSnapshot) : popNextToCommonLevel(prev, newSnapshot), currentActiveSnapshot = newSnapshot);
	}
	var classComponentUpdater = {
		enqueueSetState: function(inst, payload) {
			inst = inst._reactInternals;
			null !== inst.queue && inst.queue.push(payload);
		},
		enqueueReplaceState: function(inst, payload) {
			inst = inst._reactInternals;
			inst.replace = !0;
			inst.queue = [payload];
		},
		enqueueForceUpdate: function() {}
	};
	var emptyTreeContext = {
		id: 1,
		overflow: ""
	};
	function getTreeId(context) {
		var overflow = context.overflow;
		context = context.id;
		return (context & ~(1 << 32 - clz32(context) - 1)).toString(32) + overflow;
	}
	function pushTreeContext(baseContext, totalChildren, index) {
		var baseIdWithLeadingBit = baseContext.id;
		baseContext = baseContext.overflow;
		var baseLength = 32 - clz32(baseIdWithLeadingBit) - 1;
		baseIdWithLeadingBit &= ~(1 << baseLength);
		index += 1;
		var length = 32 - clz32(totalChildren) + baseLength;
		if (30 < length) {
			var numberOfOverflowBits = baseLength - baseLength % 5;
			length = (baseIdWithLeadingBit & (1 << numberOfOverflowBits) - 1).toString(32);
			baseIdWithLeadingBit >>= numberOfOverflowBits;
			baseLength -= numberOfOverflowBits;
			return {
				id: 1 << 32 - clz32(totalChildren) + baseLength | index << baseLength | baseIdWithLeadingBit,
				overflow: length + baseContext
			};
		}
		return {
			id: 1 << length | index << baseLength | baseIdWithLeadingBit,
			overflow: baseContext
		};
	}
	var clz32 = Math.clz32 ? Math.clz32 : clz32Fallback;
	var log = Math.log;
	var LN2 = Math.LN2;
	function clz32Fallback(x) {
		x >>>= 0;
		return 0 === x ? 32 : 31 - (log(x) / LN2 | 0) | 0;
	}
	function noop() {}
	var SuspenseException = Error("Suspense Exception: This is not a real error! It's an implementation detail of `use` to interrupt the current render. You must either rethrow it immediately, or move the `use` call outside of the `try/catch` block. Capturing without rethrowing will lead to unexpected behavior.\n\nTo handle async errors, wrap your component in an error boundary, or call the promise's `.catch` method and pass the result to `use`.");
	function trackUsedThenable(thenableState, thenable, index) {
		index = thenableState[index];
		void 0 === index ? thenableState.push(thenable) : index !== thenable && (thenable.then(noop, noop), thenable = index);
		switch (thenable.status) {
			case "fulfilled": return thenable.value;
			case "rejected":
				thenableState = thenable.reason;
				if (void 0 === thenableState && !("reason" in thenable)) throw Error("A rejected Promise was passed to React without a `reason` property. React threw a generic error from where the Promise was used to assist in identifying the problematic Promise. Make sure that instrumented Promises correctly set the `reason` property when setting `status` to `'rejected'`.");
				throw thenableState;
			default:
				"string" === typeof thenable.status ? thenable.then(noop, noop) : (thenableState = thenable, thenableState.status = "pending", thenableState.then(function(fulfilledValue) {
					if ("pending" === thenable.status) {
						var fulfilledThenable = thenable;
						fulfilledThenable.status = "fulfilled";
						fulfilledThenable.value = fulfilledValue;
					}
				}, function(error) {
					if ("pending" === thenable.status) {
						var rejectedThenable = thenable;
						rejectedThenable.status = "rejected";
						rejectedThenable.reason = error;
					}
				}));
				switch (thenable.status) {
					case "fulfilled": return thenable.value;
					case "rejected": throw thenable.reason;
				}
				suspendedThenable = thenable;
				throw SuspenseException;
		}
	}
	var suspendedThenable = null;
	function getSuspendedThenable() {
		if (null === suspendedThenable) throw Error("Expected a suspended thenable. This is a bug in React. Please file an issue.");
		var thenable = suspendedThenable;
		suspendedThenable = null;
		return thenable;
	}
	function is(x, y) {
		return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
	}
	var objectIs = "function" === typeof Object.is ? Object.is : is;
	var currentlyRenderingComponent = null;
	var currentlyRenderingTask = null;
	var currentlyRenderingRequest = null;
	var currentlyRenderingKeyPath = null;
	var firstWorkInProgressHook = null;
	var workInProgressHook = null;
	var isReRender = !1;
	var didScheduleRenderPhaseUpdate = !1;
	var localIdCounter = 0;
	var actionStateCounter = 0;
	var actionStateMatchingIndex = -1;
	var thenableIndexCounter = 0;
	var thenableState = null;
	function createRecoverableError(recoverable) {
		recoverable = recoverable._reason;
		if ("function" === typeof recoverable) try {
			var initializedReason = recoverable();
		} catch ($jscomp$unused$catch) {
			initializedReason = "The reason for browser-only rendering could not be determined because its initializer threw.";
		}
		else initializedReason = recoverable;
		initializedReason = Error("Browser-only rendering was requested by `browser()`.", void 0 === recoverable ? void 0 : { cause: initializedReason });
		Object.defineProperty(initializedReason, REACT_RECOVERABLE_TYPE, { value: !0 });
		return initializedReason;
	}
	function isRecoverableError(error) {
		return "object" !== typeof error || null === error ? !1 : !0 === error[REACT_RECOVERABLE_TYPE];
	}
	function cloneRecoverableErrorAsFatal(recoverableError) {
		var fatalRecoverableError = Error("The server render could not complete because client rendering was requested outside a Suspense boundary. See this error's cause for additional details.", hasOwnProperty.call(recoverableError, "cause") ? { cause: recoverableError.cause } : void 0);
		recoverableError = recoverableError.stack;
		if (void 0 !== recoverableError) {
			var frameStart = recoverableError.indexOf("\n");
			fatalRecoverableError.stack = fatalRecoverableError.name + ": " + fatalRecoverableError.message + (-1 === frameStart ? "" : recoverableError.slice(frameStart));
		} else fatalRecoverableError.stack = void 0;
		return fatalRecoverableError;
	}
	var renderPhaseUpdates = null;
	var numberOfReRenders = 0;
	function resolveCurrentlyRenderingComponent() {
		if (null === currentlyRenderingComponent) throw Error("Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.");
		return currentlyRenderingComponent;
	}
	function createHook() {
		if (0 < numberOfReRenders) throw Error("Rendered more hooks than during the previous render");
		return {
			memoizedState: null,
			queue: null,
			next: null
		};
	}
	function createWorkInProgressHook() {
		null === workInProgressHook ? null === firstWorkInProgressHook ? (isReRender = !1, firstWorkInProgressHook = workInProgressHook = createHook()) : (isReRender = !0, workInProgressHook = firstWorkInProgressHook) : null === workInProgressHook.next ? (isReRender = !1, workInProgressHook = workInProgressHook.next = createHook()) : (isReRender = !0, workInProgressHook = workInProgressHook.next);
		return workInProgressHook;
	}
	function getThenableStateAfterSuspending() {
		var state = thenableState;
		thenableState = null;
		return state;
	}
	function resetHooksState() {
		currentlyRenderingKeyPath = currentlyRenderingRequest = currentlyRenderingTask = currentlyRenderingComponent = null;
		didScheduleRenderPhaseUpdate = !1;
		firstWorkInProgressHook = null;
		numberOfReRenders = 0;
		workInProgressHook = renderPhaseUpdates = null;
	}
	function basicStateReducer(state, action) {
		return "function" === typeof action ? action(state) : action;
	}
	function useReducer(reducer, initialArg, init) {
		currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
		workInProgressHook = createWorkInProgressHook();
		if (isReRender) {
			var queue = workInProgressHook.queue;
			initialArg = queue.dispatch;
			if (null !== renderPhaseUpdates && (init = renderPhaseUpdates.get(queue), void 0 !== init)) {
				renderPhaseUpdates.delete(queue);
				queue = workInProgressHook.memoizedState;
				do
					queue = reducer(queue, init.action), init = init.next;
				while (null !== init);
				workInProgressHook.memoizedState = queue;
				return [queue, initialArg];
			}
			return [workInProgressHook.memoizedState, initialArg];
		}
		reducer = reducer === basicStateReducer ? "function" === typeof initialArg ? initialArg() : initialArg : void 0 !== init ? init(initialArg) : initialArg;
		workInProgressHook.memoizedState = reducer;
		reducer = workInProgressHook.queue = {
			last: null,
			dispatch: null
		};
		reducer = reducer.dispatch = dispatchAction.bind(null, currentlyRenderingComponent, reducer);
		return [workInProgressHook.memoizedState, reducer];
	}
	function useMemo(nextCreate, deps) {
		currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
		workInProgressHook = createWorkInProgressHook();
		deps = void 0 === deps ? null : deps;
		if (null !== workInProgressHook) {
			var prevState = workInProgressHook.memoizedState;
			if (null !== prevState && null !== deps) {
				var prevDeps = prevState[1];
				a: if (null === prevDeps) prevDeps = !1;
				else {
					for (var i = 0; i < prevDeps.length && i < deps.length; i++) if (!objectIs(deps[i], prevDeps[i])) {
						prevDeps = !1;
						break a;
					}
					prevDeps = !0;
				}
				if (prevDeps) return prevState[0];
			}
		}
		nextCreate = nextCreate();
		workInProgressHook.memoizedState = [nextCreate, deps];
		return nextCreate;
	}
	function dispatchAction(componentIdentity, queue, action) {
		if (25 <= numberOfReRenders) throw Error("Too many re-renders. React limits the number of renders to prevent an infinite loop.");
		if (componentIdentity === currentlyRenderingComponent) if (didScheduleRenderPhaseUpdate = !0, componentIdentity = {
			action,
			next: null
		}, null === renderPhaseUpdates && (renderPhaseUpdates = /* @__PURE__ */ new Map()), action = renderPhaseUpdates.get(queue), void 0 === action) renderPhaseUpdates.set(queue, componentIdentity);
		else {
			for (queue = action; null !== queue.next;) queue = queue.next;
			queue.next = componentIdentity;
		}
	}
	function throwOnUseEffectEventCall() {
		throw Error("A function wrapped in useEffectEvent can't be called during rendering.");
	}
	function unsupportedStartTransition() {
		throw Error("startTransition cannot be called during server rendering.");
	}
	function unsupportedSetOptimisticState() {
		throw Error("Cannot update optimistic state while rendering.");
	}
	function createPostbackActionStateKey(permalink, componentKeyPath, hookIndex) {
		if (void 0 !== permalink) return "p" + permalink;
		permalink = JSON.stringify([
			componentKeyPath,
			null,
			hookIndex
		]);
		componentKeyPath = crypto.createHash("md5");
		componentKeyPath.update(permalink);
		return "k" + componentKeyPath.digest("hex");
	}
	function useActionState(action, initialState, permalink) {
		resolveCurrentlyRenderingComponent();
		var actionStateHookIndex = actionStateCounter++, request = currentlyRenderingRequest;
		if ("function" === typeof action.$$FORM_ACTION) {
			var nextPostbackStateKey = null, componentKeyPath = currentlyRenderingKeyPath;
			request = request.formState;
			var isSignatureEqual = action.$$IS_SIGNATURE_EQUAL;
			if (null !== request && "function" === typeof isSignatureEqual) {
				var postbackKey = request[1];
				isSignatureEqual.call(action, request[2], request[3]) && (nextPostbackStateKey = createPostbackActionStateKey(permalink, componentKeyPath, actionStateHookIndex), postbackKey === nextPostbackStateKey && (actionStateMatchingIndex = actionStateHookIndex, initialState = request[0]));
			}
			var boundAction = action.bind(null, initialState);
			action = function(payload) {
				boundAction(payload);
			};
			"function" === typeof boundAction.$$FORM_ACTION && (action.$$FORM_ACTION = function(prefix) {
				prefix = boundAction.$$FORM_ACTION(prefix);
				void 0 !== permalink && (permalink += "", prefix.action = permalink);
				var formData = prefix.data;
				formData && (null === nextPostbackStateKey && (nextPostbackStateKey = createPostbackActionStateKey(permalink, componentKeyPath, actionStateHookIndex)), formData.append("$ACTION_KEY", nextPostbackStateKey));
				return prefix;
			});
			return [
				initialState,
				action,
				!1
			];
		}
		var boundAction$22 = action.bind(null, initialState);
		return [
			initialState,
			function(payload) {
				boundAction$22(payload);
			},
			!1
		];
	}
	function unwrapThenable(thenable) {
		var index = thenableIndexCounter;
		thenableIndexCounter += 1;
		null === thenableState && (thenableState = []);
		return trackUsedThenable(thenableState, thenable, index);
	}
	function unsupportedRefresh() {
		throw Error("Cache cannot be refreshed during server rendering.");
	}
	var HooksDispatcher = {
		readContext: function(context) {
			return context._currentValue;
		},
		use: function(usable) {
			if (null !== usable && "object" === typeof usable) {
				if ("function" === typeof usable.then) return unwrapThenable(usable);
				if (usable.$$typeof === REACT_RECOVERABLE_TYPE) throw createRecoverableError(usable);
				if (usable.$$typeof === REACT_CONTEXT_TYPE) return usable._currentValue;
			}
			throw Error("An unsupported type was passed to use(): " + String(usable));
		},
		useContext: function(context) {
			resolveCurrentlyRenderingComponent();
			return context._currentValue;
		},
		useMemo,
		useReducer,
		useRef: function(initialValue) {
			currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
			workInProgressHook = createWorkInProgressHook();
			var previousRef = workInProgressHook.memoizedState;
			return null === previousRef ? (initialValue = { current: initialValue }, workInProgressHook.memoizedState = initialValue) : previousRef;
		},
		useState: function(initialState) {
			return useReducer(basicStateReducer, initialState);
		},
		useInsertionEffect: noop,
		useLayoutEffect: noop,
		useCallback: function(callback, deps) {
			return useMemo(function() {
				return callback;
			}, deps);
		},
		useImperativeHandle: noop,
		useEffect: noop,
		useDebugValue: noop,
		useDeferredValue: function(value, initialValue) {
			resolveCurrentlyRenderingComponent();
			return void 0 !== initialValue ? initialValue : value;
		},
		useTransition: function() {
			resolveCurrentlyRenderingComponent();
			return [!1, unsupportedStartTransition];
		},
		useId: function() {
			var treeId = getTreeId(currentlyRenderingTask.treeContext), resumableState = currentResumableState;
			if (null === resumableState) throw Error("Invalid hook call. Hooks can only be called inside of the body of a function component.");
			return makeId(resumableState, treeId, localIdCounter++);
		},
		useSyncExternalStore: function(subscribe, getSnapshot, getServerSnapshot) {
			if (void 0 === getServerSnapshot) throw Error("Missing getServerSnapshot, which is required for server-rendered content. Will revert to client rendering.");
			return getServerSnapshot();
		},
		useOptimistic: function(passthrough) {
			resolveCurrentlyRenderingComponent();
			return [passthrough, unsupportedSetOptimisticState];
		},
		useActionState,
		useFormState: useActionState,
		useHostTransitionStatus: function() {
			resolveCurrentlyRenderingComponent();
			return sharedNotPendingObject;
		},
		useMemoCache: function(size) {
			for (var data = Array(size), i = 0; i < size; i++) data[i] = REACT_MEMO_CACHE_SENTINEL;
			return data;
		},
		useCacheRefresh: function() {
			return unsupportedRefresh;
		},
		useEffectEvent: function() {
			return throwOnUseEffectEventCall;
		}
	};
	var currentResumableState = null;
	var DefaultAsyncDispatcher = {
		getCacheForType: function() {
			throw Error("Not implemented.");
		},
		cacheSignal: function() {
			throw Error("Not implemented.");
		}
	};
	function prepareStackTrace(error, structuredStackTrace) {
		error = (error.name || "Error") + ": " + (error.message || "");
		for (var i = 0; i < structuredStackTrace.length; i++) error += "\n    at " + structuredStackTrace[i].toString();
		return error;
	}
	var prefix;
	var suffix;
	function describeBuiltInComponentFrame(name) {
		if (void 0 === prefix) try {
			throw Error();
		} catch (x) {
			var match = x.stack.trim().match(/\n( *(at )?)/);
			prefix = match && match[1] || "";
			suffix = -1 < x.stack.indexOf("\n    at") ? " (<anonymous>)" : -1 < x.stack.indexOf("@") ? "@unknown:0:0" : "";
		}
		return "\n" + prefix + name + suffix;
	}
	var reentry = !1;
	function describeNativeComponentFrame(fn, construct) {
		if (!fn || reentry) return "";
		reentry = !0;
		var previousPrepareStackTrace = Error.prepareStackTrace;
		Error.prepareStackTrace = prepareStackTrace;
		try {
			var RunInRootFrame = { DetermineComponentFrameRoot: function() {
				try {
					if (construct) {
						var Fake = function() {
							throw Error();
						};
						Object.defineProperty(Fake.prototype, "props", { set: function() {
							throw Error();
						} });
						if ("object" === typeof Reflect && Reflect.construct) {
							try {
								Reflect.construct(Fake, []);
							} catch (x) {
								var control = x;
							}
							Reflect.construct(fn, [], Fake);
						} else {
							try {
								Fake.call();
							} catch (x$24) {
								control = x$24;
							}
							Fake = !1;
							try {
								var prevProps = Object.getOwnPropertyDescriptor(fn.prototype, "props");
								Object.defineProperty(fn.prototype, "props", {
									configurable: !0,
									set: function() {
										throw Error();
									}
								});
								Fake = !0;
								new fn();
							} finally {
								Fake && (void 0 !== prevProps ? Object.defineProperty(fn.prototype, "props", prevProps) : delete fn.prototype.props);
							}
						}
					} else {
						try {
							throw Error();
						} catch (x$25) {
							control = x$25;
						}
						(Fake = fn()) && "function" === typeof Fake.catch && Fake.catch(function() {});
					}
				} catch (sample) {
					if (sample && control && "string" === typeof sample.stack) return [sample.stack, control.stack];
				}
				return [null, null];
			} };
			RunInRootFrame.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
			var namePropDescriptor = Object.getOwnPropertyDescriptor(RunInRootFrame.DetermineComponentFrameRoot, "name");
			namePropDescriptor && namePropDescriptor.configurable && Object.defineProperty(RunInRootFrame.DetermineComponentFrameRoot, "name", { value: "DetermineComponentFrameRoot" });
			var _RunInRootFrame$Deter = RunInRootFrame.DetermineComponentFrameRoot(), sampleStack = _RunInRootFrame$Deter[0], controlStack = _RunInRootFrame$Deter[1];
			if (sampleStack && controlStack) {
				var sampleLines = sampleStack.split("\n"), controlLines = controlStack.split("\n");
				for (namePropDescriptor = RunInRootFrame = 0; RunInRootFrame < sampleLines.length && !sampleLines[RunInRootFrame].includes("DetermineComponentFrameRoot");) RunInRootFrame++;
				for (; namePropDescriptor < controlLines.length && !controlLines[namePropDescriptor].includes("DetermineComponentFrameRoot");) namePropDescriptor++;
				if (RunInRootFrame === sampleLines.length || namePropDescriptor === controlLines.length) for (RunInRootFrame = sampleLines.length - 1, namePropDescriptor = controlLines.length - 1; 1 <= RunInRootFrame && 0 <= namePropDescriptor && sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor];) namePropDescriptor--;
				for (; 1 <= RunInRootFrame && 0 <= namePropDescriptor; RunInRootFrame--, namePropDescriptor--) if (sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor]) {
					if (1 !== RunInRootFrame || 1 !== namePropDescriptor) do
						if (RunInRootFrame--, namePropDescriptor--, 0 > namePropDescriptor || sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor]) {
							var frame = "\n" + sampleLines[RunInRootFrame].replace(" at new ", " at ");
							fn.displayName && frame.includes("<anonymous>") && (frame = frame.replace("<anonymous>", fn.displayName));
							return frame;
						}
					while (1 <= RunInRootFrame && 0 <= namePropDescriptor);
					break;
				}
			}
		} finally {
			reentry = !1, Error.prepareStackTrace = previousPrepareStackTrace;
		}
		return (previousPrepareStackTrace = fn ? fn.displayName || fn.name : "") ? describeBuiltInComponentFrame(previousPrepareStackTrace) : "";
	}
	function describeComponentStackByType(type) {
		if ("string" === typeof type) return describeBuiltInComponentFrame(type);
		if ("function" === typeof type) return type.prototype && type.prototype.isReactComponent ? describeNativeComponentFrame(type, !0) : describeNativeComponentFrame(type, !1);
		if ("object" === typeof type && null !== type) {
			switch (type.$$typeof) {
				case REACT_FORWARD_REF_TYPE: return describeNativeComponentFrame(type.render, !1);
				case REACT_MEMO_TYPE: return describeNativeComponentFrame(type.type, !1);
				case REACT_LAZY_TYPE:
					var lazyComponent = type, payload = lazyComponent._payload;
					lazyComponent = lazyComponent._init;
					try {
						type = lazyComponent(payload);
					} catch (x) {
						return describeBuiltInComponentFrame("Lazy");
					}
					return describeComponentStackByType(type);
			}
			if ("string" === typeof type.name) {
				a: {
					payload = type.name;
					lazyComponent = type.env;
					var location = type.debugLocation;
					if (null != location && (type = Error.prepareStackTrace, Error.prepareStackTrace = prepareStackTrace, location = location.stack, Error.prepareStackTrace = type, location.startsWith("Error: react-stack-top-frame\n") && (location = location.slice(29)), type = location.indexOf("\n"), -1 !== type && (location = location.slice(type + 1)), type = location.indexOf("react_stack_bottom_frame"), -1 !== type && (type = location.lastIndexOf("\n", type)), type = -1 !== type ? location = location.slice(0, type) : "", location = type.lastIndexOf("\n"), type = -1 === location ? type : type.slice(location + 1), -1 !== type.indexOf(payload))) {
						payload = "\n" + type;
						break a;
					}
					payload = describeBuiltInComponentFrame(payload + (lazyComponent ? " [" + lazyComponent + "]" : ""));
				}
				return payload;
			}
		}
		switch (type) {
			case REACT_SUSPENSE_LIST_TYPE: return describeBuiltInComponentFrame("SuspenseList");
			case REACT_SUSPENSE_TYPE: return describeBuiltInComponentFrame("Suspense");
			case REACT_VIEW_TRANSITION_TYPE: return describeBuiltInComponentFrame("ViewTransition");
		}
		return "";
	}
	function getViewTransitionClassName(defaultClass, eventClass) {
		defaultClass = null == defaultClass || "string" === typeof defaultClass ? defaultClass : defaultClass.default;
		eventClass = null == eventClass || "string" === typeof eventClass ? eventClass : eventClass.default;
		return null == eventClass ? "auto" === defaultClass ? null : defaultClass : "auto" === eventClass ? null : eventClass;
	}
	function isEligibleForOutlining(request, boundary) {
		return (500 < boundary.byteSize || hasSuspenseyContent(boundary.contentState, !1) || boundary.defer) && null === boundary.preamble;
	}
	function defaultErrorHandler(error) {
		if ("object" === typeof error && null !== error && "string" === typeof error.environmentName) {
			var JSCompiler_inline_result = error.environmentName;
			error = [error].slice(0);
			"string" === typeof error[0] ? error.splice(0, 1, "\x1B[0m\x1B[7m%c%s\x1B[0m%c " + error[0], "background: #e6e6e6;background: light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.25));color: #000000;color: light-dark(#000000, #ffffff);border-radius: 2px", " " + JSCompiler_inline_result + " ", "") : error.splice(0, 0, "\x1B[0m\x1B[7m%c%s\x1B[0m%c", "background: #e6e6e6;background: light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.25));color: #000000;color: light-dark(#000000, #ffffff);border-radius: 2px", " " + JSCompiler_inline_result + " ", "");
			error.unshift(console);
			JSCompiler_inline_result = bind.apply(console.error, error);
			JSCompiler_inline_result();
		} else console.error(error);
		return null;
	}
	function RequestInstance(resumableState, renderState, rootFormatContext, progressiveChunkSize, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError, formState) {
		var abortSet = /* @__PURE__ */ new Set();
		this.destination = null;
		this.flushScheduled = !1;
		this.resumableState = resumableState;
		this.renderState = renderState;
		this.rootFormatContext = rootFormatContext;
		this.progressiveChunkSize = void 0 === progressiveChunkSize ? 12800 : progressiveChunkSize;
		this.status = 10;
		this.fatalError = null;
		this.aborted = !1;
		this.pendingRootTasks = this.allPendingTasks = this.nextSegmentId = 0;
		this.completedPreambleSegments = this.completedRootSegment = null;
		this.byteSize = 0;
		this.abortableTasks = abortSet;
		this.pingedTasks = [];
		this.currentTask = null;
		this.clientRenderedBoundaries = [];
		this.completedBoundaries = [];
		this.partialBoundaries = [];
		this.postponedState = this.trackedPostpones = null;
		this.onError = void 0 === onError ? defaultErrorHandler : onError;
		this.onBrowserBailout = void 0 === onBrowserBailout ? noop : onBrowserBailout;
		this.onAllReady = void 0 === onAllReady ? noop : onAllReady;
		this.onShellReady = void 0 === onShellReady ? noop : onShellReady;
		this.onShellError = void 0 === onShellError ? noop : onShellError;
		this.onFatalError = void 0 === onFatalError ? noop : onFatalError;
		this.renderLifetimeController = null;
		this.formState = void 0 === formState ? null : formState;
	}
	function createRequest(children, resumableState, renderState, rootFormatContext, progressiveChunkSize, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError, formState) {
		resumableState = new RequestInstance(resumableState, renderState, rootFormatContext, progressiveChunkSize, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError, formState);
		renderState = createPendingSegment(resumableState, 0, null, rootFormatContext, !1, !1);
		renderState.parentFlushed = !0;
		children = createRenderTask(resumableState, null, children, -1, null, renderState, null, null, resumableState.abortableTasks, null, rootFormatContext, null, emptyTreeContext, null, null);
		pushComponentStack(children);
		resumableState.pingedTasks.push(children);
		return resumableState;
	}
	function createPrerenderRequest(children, resumableState, renderState, rootFormatContext, progressiveChunkSize, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError) {
		children = createRequest(children, resumableState, renderState, rootFormatContext, progressiveChunkSize, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError, void 0);
		children.trackedPostpones = {
			workingMap: /* @__PURE__ */ new Map(),
			rootNodes: [],
			rootSlots: null
		};
		return children;
	}
	function resumeRequest(children, postponedState, renderState, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError) {
		renderState = new RequestInstance(postponedState.resumableState, renderState, postponedState.rootFormatContext, postponedState.progressiveChunkSize, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError, null);
		renderState.nextSegmentId = postponedState.nextSegmentId;
		if ("number" === typeof postponedState.replaySlots) return onError = createPendingSegment(renderState, 0, null, postponedState.rootFormatContext, !1, !1), onError.parentFlushed = !0, children = createRenderTask(renderState, null, children, -1, null, onError, null, null, renderState.abortableTasks, null, postponedState.rootFormatContext, null, emptyTreeContext, null, null), pushComponentStack(children), renderState.pingedTasks.push(children), renderState;
		children = createReplayTask(renderState, null, {
			nodes: postponedState.replayNodes,
			slots: postponedState.replaySlots,
			pendingTasks: 0
		}, children, -1, null, null, renderState.abortableTasks, null, postponedState.rootFormatContext, null, emptyTreeContext, null, null);
		pushComponentStack(children);
		renderState.pingedTasks.push(children);
		return renderState;
	}
	function resumeAndPrerenderRequest(children, postponedState, renderState, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError) {
		children = resumeRequest(children, postponedState, renderState, onError, onBrowserBailout, onAllReady, onShellReady, onShellError, onFatalError);
		children.trackedPostpones = {
			workingMap: /* @__PURE__ */ new Map(),
			rootNodes: [],
			rootSlots: null
		};
		return children;
	}
	var currentRequest = null;
	function resolveRequest() {
		if (currentRequest) return currentRequest;
		var store = requestStorage.getStore();
		return store ? store : null;
	}
	function pingTask(request, task) {
		request.pingedTasks.push(task);
		1 === request.pingedTasks.length && (request.flushScheduled = null !== request.destination, null !== request.trackedPostpones || 10 === request.status ? scheduleMicrotask(function() {
			return performWork(request);
		}) : setImmediate(function() {
			return performWork(request);
		}));
	}
	function createSuspenseBoundary(request, row, fallbackAbortableTasks, preamble, defer) {
		fallbackAbortableTasks = {
			status: 0,
			rootSegmentID: -1,
			parentFlushed: !1,
			pendingTasks: 0,
			row,
			completedSegments: [],
			byteSize: 0,
			defer,
			fallbackAbortableTasks,
			errorDigest: null,
			contentState: createHoistableState(),
			fallbackState: createHoistableState(),
			preamble,
			tracked: null
		};
		null !== row && (row.pendingTasks++, preamble = row.boundaries, null !== preamble && (request.allPendingTasks++, fallbackAbortableTasks.pendingTasks++, preamble.push(fallbackAbortableTasks)), request = row.inheritedHoistables, null !== request && hoistHoistables(fallbackAbortableTasks.contentState, request));
		return fallbackAbortableTasks;
	}
	function createRenderTask(request, thenableState, node, childIndex, blockedBoundary, blockedSegment, blockedPreamble, hoistableState, abortSet, keyPath, formatContext, context, treeContext, row, componentStack) {
		request.allPendingTasks++;
		null === blockedBoundary ? request.pendingRootTasks++ : blockedBoundary.pendingTasks++;
		null !== row && row.pendingTasks++;
		var task = {
			replay: null,
			node,
			childIndex,
			ping: {
				resolve: function() {
					return pingTask(request, task);
				},
				reject: function(error) {
					request.aborted ? task.abortSet.delete(task) && finishAbortedTask(task, request, error) : pingTask(request, task);
				}
			},
			blockedBoundary,
			blockedSegment,
			blockedPreamble,
			hoistableState,
			abortSet,
			keyPath,
			formatContext,
			context,
			treeContext,
			row,
			componentStack,
			thenableState
		};
		abortSet.add(task);
		return task;
	}
	function createReplayTask(request, thenableState, replay, node, childIndex, blockedBoundary, hoistableState, abortSet, keyPath, formatContext, context, treeContext, row, componentStack) {
		request.allPendingTasks++;
		null === blockedBoundary ? request.pendingRootTasks++ : blockedBoundary.pendingTasks++;
		null !== row && row.pendingTasks++;
		replay.pendingTasks++;
		var task = {
			replay,
			node,
			childIndex,
			ping: {
				resolve: function() {
					return pingTask(request, task);
				},
				reject: function(error) {
					request.aborted ? task.abortSet.delete(task) && finishAbortedTask(task, request, error) : pingTask(request, task);
				}
			},
			blockedBoundary,
			blockedSegment: null,
			blockedPreamble: null,
			hoistableState,
			abortSet,
			keyPath,
			formatContext,
			context,
			treeContext,
			row,
			componentStack,
			thenableState
		};
		abortSet.add(task);
		return task;
	}
	function createPendingSegment(request, index, boundary, parentFormatContext, lastPushedText, textEmbedded) {
		return {
			status: 0,
			parentFlushed: !1,
			id: -1,
			index,
			chunks: [],
			children: [],
			preambleChildren: [],
			parentFormatContext,
			boundary,
			lastPushedText,
			textEmbedded
		};
	}
	function pushComponentStack(task) {
		var node = task.node;
		if ("object" === typeof node && null !== node) switch (node.$$typeof) {
			case REACT_ELEMENT_TYPE: task.componentStack = {
				parent: task.componentStack,
				type: node.type
			};
		}
	}
	function replaceSuspenseComponentStackWithSuspenseFallbackStack(componentStack) {
		return null === componentStack ? null : {
			parent: componentStack.parent,
			type: "Suspense Fallback"
		};
	}
	function getThrownInfo(node$jscomp$0) {
		var errorInfo = {};
		node$jscomp$0 && Object.defineProperty(errorInfo, "componentStack", {
			configurable: !0,
			enumerable: !0,
			get: function() {
				try {
					var info = "", node = node$jscomp$0;
					do
						info += describeComponentStackByType(node.type), node = node.parent;
					while (node);
					var JSCompiler_inline_result = info;
				} catch (x) {
					JSCompiler_inline_result = "\nError generating stack: " + x.message + "\n" + x.stack;
				}
				Object.defineProperty(errorInfo, "componentStack", { value: JSCompiler_inline_result });
				return JSCompiler_inline_result;
			}
		});
		return errorInfo;
	}
	function logRecoverableError(request, error, errorInfo) {
		if (isRecoverableError(error)) return request = request.onBrowserBailout, request(error, errorInfo), "";
		request = request.onError;
		error = request(error, errorInfo);
		if (null == error || "string" === typeof error) return "" === error ? void 0 : error;
	}
	function fatalError(request, error) {
		var onShellError = request.onShellError, onFatalError = request.onFatalError;
		0 !== request.pendingRootTasks && onShellError(error);
		onFatalError(error);
		endRenderLifetime(request);
		null !== request.destination ? (request.status = 13, request.destination.destroy(error)) : (request.status = 12, request.aborted || (request.fatalError = error));
	}
	function finishSuspenseListRow(request, row) {
		unblockSuspenseListRow(request, row.next, row.hoistables);
	}
	function unblockSuspenseListRow(request, unblockedRow, inheritedHoistables) {
		for (; null !== unblockedRow;) {
			null !== inheritedHoistables && (hoistHoistables(unblockedRow.hoistables, inheritedHoistables), unblockedRow.inheritedHoistables = inheritedHoistables);
			var unblockedBoundaries = unblockedRow.boundaries;
			if (null !== unblockedBoundaries) {
				unblockedRow.boundaries = null;
				for (var i = 0; i < unblockedBoundaries.length; i++) {
					var unblockedBoundary = unblockedBoundaries[i];
					null !== inheritedHoistables && hoistHoistables(unblockedBoundary.contentState, inheritedHoistables);
					finishedTask(request, unblockedBoundary, null, null);
				}
			}
			unblockedRow.pendingTasks--;
			if (0 < unblockedRow.pendingTasks) break;
			inheritedHoistables = unblockedRow.hoistables;
			unblockedRow = unblockedRow.next;
		}
	}
	function tryToResolveTogetherRow(request, togetherRow) {
		var boundaries = togetherRow.boundaries;
		if (null !== boundaries && togetherRow.pendingTasks === boundaries.length) {
			for (var allCompleteAndInlinable = !0, i = 0; i < boundaries.length; i++) {
				var rowBoundary = boundaries[i];
				if (1 !== rowBoundary.pendingTasks || rowBoundary.parentFlushed || isEligibleForOutlining(request, rowBoundary)) {
					allCompleteAndInlinable = !1;
					break;
				}
			}
			allCompleteAndInlinable && unblockSuspenseListRow(request, togetherRow, togetherRow.hoistables);
		}
	}
	function createSuspenseListRow(previousRow) {
		var newRow = {
			pendingTasks: 1,
			boundaries: null,
			hoistables: createHoistableState(),
			inheritedHoistables: null,
			together: !1,
			next: null
		};
		null !== previousRow && 0 < previousRow.pendingTasks && (newRow.pendingTasks++, newRow.boundaries = [], previousRow.next = newRow);
		return newRow;
	}
	function renderSuspenseListRows(request, task, keyPath, rows, revealOrder) {
		var prevKeyPath = task.keyPath, prevTreeContext = task.treeContext, prevRow = task.row;
		task.keyPath = keyPath;
		keyPath = rows.length;
		var previousSuspenseListRow = null;
		if (null !== task.replay) {
			var resumeSlots = task.replay.slots;
			if (null !== resumeSlots && "object" === typeof resumeSlots) for (var n = 0; n < keyPath; n++) {
				var i = "backwards" !== revealOrder && "unstable_legacy-backwards" !== revealOrder ? n : keyPath - 1 - n, node = rows[i];
				task.row = previousSuspenseListRow = createSuspenseListRow(previousSuspenseListRow);
				task.treeContext = pushTreeContext(prevTreeContext, keyPath, i);
				var resumeSegmentID = resumeSlots[i];
				"number" === typeof resumeSegmentID ? (resumeNode(request, task, resumeSegmentID, node, i), delete resumeSlots[i]) : renderNode(request, task, node, i);
				0 === --previousSuspenseListRow.pendingTasks && finishSuspenseListRow(request, previousSuspenseListRow);
			}
			else for (resumeSlots = 0; resumeSlots < keyPath; resumeSlots++) n = "backwards" !== revealOrder && "unstable_legacy-backwards" !== revealOrder ? resumeSlots : keyPath - 1 - resumeSlots, i = rows[n], task.row = previousSuspenseListRow = createSuspenseListRow(previousSuspenseListRow), task.treeContext = pushTreeContext(prevTreeContext, keyPath, n), renderNode(request, task, i, n), 0 === --previousSuspenseListRow.pendingTasks && finishSuspenseListRow(request, previousSuspenseListRow);
		} else if ("backwards" !== revealOrder && "unstable_legacy-backwards" !== revealOrder) for (revealOrder = 0; revealOrder < keyPath; revealOrder++) resumeSlots = rows[revealOrder], task.row = previousSuspenseListRow = createSuspenseListRow(previousSuspenseListRow), task.treeContext = pushTreeContext(prevTreeContext, keyPath, revealOrder), renderNode(request, task, resumeSlots, revealOrder), 0 === --previousSuspenseListRow.pendingTasks && finishSuspenseListRow(request, previousSuspenseListRow);
		else {
			resumeSlots = task.blockedSegment;
			n = resumeSlots.children.length;
			i = resumeSlots.chunks.length;
			for (node = 0; node < keyPath; node++) {
				resumeSegmentID = "unstable_legacy-backwards" === revealOrder ? keyPath - 1 - node : node;
				var node$40 = rows[resumeSegmentID];
				task.row = previousSuspenseListRow = createSuspenseListRow(previousSuspenseListRow);
				task.treeContext = pushTreeContext(prevTreeContext, keyPath, resumeSegmentID);
				var newSegment = createPendingSegment(request, i, null, task.formatContext, 0 === resumeSegmentID ? resumeSlots.lastPushedText : !0, !0);
				resumeSlots.children.splice(n, 0, newSegment);
				task.blockedSegment = newSegment;
				try {
					renderNode(request, task, node$40, resumeSegmentID), newSegment.lastPushedText && newSegment.textEmbedded && newSegment.chunks.push(textSeparator), newSegment.status = 1, finishedSegment(request, task.blockedBoundary, newSegment), 0 === --previousSuspenseListRow.pendingTasks && finishSuspenseListRow(request, previousSuspenseListRow);
				} catch (thrownValue) {
					throw newSegment.status = request.aborted ? 3 : 4, thrownValue;
				}
			}
			task.blockedSegment = resumeSlots;
			resumeSlots.lastPushedText = !1;
		}
		null !== prevRow && null !== previousSuspenseListRow && 0 < previousSuspenseListRow.pendingTasks && (prevRow.pendingTasks++, previousSuspenseListRow.next = prevRow);
		task.treeContext = prevTreeContext;
		task.row = prevRow;
		task.keyPath = prevKeyPath;
	}
	function renderWithHooks(request, task, keyPath, Component, props, secondArg) {
		var prevThenableState = task.thenableState;
		task.thenableState = null;
		currentlyRenderingComponent = {};
		currentlyRenderingTask = task;
		currentlyRenderingRequest = request;
		currentlyRenderingKeyPath = keyPath;
		actionStateCounter = localIdCounter = 0;
		actionStateMatchingIndex = -1;
		thenableIndexCounter = 0;
		thenableState = prevThenableState;
		for (request = Component(props, secondArg); didScheduleRenderPhaseUpdate;) didScheduleRenderPhaseUpdate = !1, actionStateCounter = localIdCounter = 0, actionStateMatchingIndex = -1, thenableIndexCounter = 0, numberOfReRenders += 1, workInProgressHook = null, request = Component(props, secondArg);
		resetHooksState();
		return request;
	}
	function finishFunctionComponent(request, task, keyPath, children, hasId, actionStateCount, actionStateMatchingIndex) {
		var didEmitActionStateMarkers = !1;
		if (0 !== actionStateCount && null !== request.formState) {
			var segment = task.blockedSegment;
			if (null !== segment) {
				didEmitActionStateMarkers = !0;
				segment = segment.chunks;
				for (var i = 0; i < actionStateCount; i++) i === actionStateMatchingIndex ? segment.push(formStateMarkerIsMatching) : segment.push(formStateMarkerIsNotMatching);
			}
		}
		actionStateCount = task.keyPath;
		task.keyPath = keyPath;
		hasId ? (keyPath = task.treeContext, task.treeContext = pushTreeContext(keyPath, 1, 0), renderNode(request, task, children, -1), task.treeContext = keyPath) : didEmitActionStateMarkers ? renderNode(request, task, children, -1) : renderNodeDestructive(request, task, children, -1);
		task.keyPath = actionStateCount;
	}
	function renderElement(request, task, keyPath, type, props, ref) {
		if ("function" === typeof type) if (type.prototype && type.prototype.isReactComponent) {
			var newProps = props;
			if ("ref" in props) {
				newProps = {};
				for (var propName in props) "ref" !== propName && (newProps[propName] = props[propName]);
			}
			var defaultProps = type.defaultProps;
			if (defaultProps) {
				newProps === props && (newProps = assign({}, newProps, props));
				for (var propName$45 in defaultProps) void 0 === newProps[propName$45] && (newProps[propName$45] = defaultProps[propName$45]);
			}
			var JSCompiler_inline_result = newProps;
			var context = emptyContextObject, contextType = type.contextType;
			"object" === typeof contextType && null !== contextType && (context = contextType._currentValue);
			var JSCompiler_inline_result$jscomp$0 = new type(JSCompiler_inline_result, context);
			var initialState = void 0 !== JSCompiler_inline_result$jscomp$0.state ? JSCompiler_inline_result$jscomp$0.state : null;
			JSCompiler_inline_result$jscomp$0.updater = classComponentUpdater;
			JSCompiler_inline_result$jscomp$0.props = JSCompiler_inline_result;
			JSCompiler_inline_result$jscomp$0.state = initialState;
			var internalInstance = {
				queue: [],
				replace: !1
			};
			JSCompiler_inline_result$jscomp$0._reactInternals = internalInstance;
			var contextType$jscomp$0 = type.contextType;
			JSCompiler_inline_result$jscomp$0.context = "object" === typeof contextType$jscomp$0 && null !== contextType$jscomp$0 ? contextType$jscomp$0._currentValue : emptyContextObject;
			var getDerivedStateFromProps = type.getDerivedStateFromProps;
			if ("function" === typeof getDerivedStateFromProps) {
				var partialState = getDerivedStateFromProps(JSCompiler_inline_result, initialState);
				JSCompiler_inline_result$jscomp$0.state = null === partialState || void 0 === partialState ? initialState : assign({}, initialState, partialState);
			}
			if ("function" !== typeof type.getDerivedStateFromProps && "function" !== typeof JSCompiler_inline_result$jscomp$0.getSnapshotBeforeUpdate && ("function" === typeof JSCompiler_inline_result$jscomp$0.UNSAFE_componentWillMount || "function" === typeof JSCompiler_inline_result$jscomp$0.componentWillMount)) {
				var oldState = JSCompiler_inline_result$jscomp$0.state;
				"function" === typeof JSCompiler_inline_result$jscomp$0.componentWillMount && JSCompiler_inline_result$jscomp$0.componentWillMount();
				"function" === typeof JSCompiler_inline_result$jscomp$0.UNSAFE_componentWillMount && JSCompiler_inline_result$jscomp$0.UNSAFE_componentWillMount();
				oldState !== JSCompiler_inline_result$jscomp$0.state && classComponentUpdater.enqueueReplaceState(JSCompiler_inline_result$jscomp$0, JSCompiler_inline_result$jscomp$0.state, null);
				if (null !== internalInstance.queue && 0 < internalInstance.queue.length) {
					var oldQueue = internalInstance.queue, oldReplace = internalInstance.replace;
					internalInstance.queue = null;
					internalInstance.replace = !1;
					if (oldReplace && 1 === oldQueue.length) JSCompiler_inline_result$jscomp$0.state = oldQueue[0];
					else {
						for (var nextState = oldReplace ? oldQueue[0] : JSCompiler_inline_result$jscomp$0.state, dontMutate = !0, i = oldReplace ? 1 : 0; i < oldQueue.length; i++) {
							var partial = oldQueue[i], partialState$jscomp$0 = "function" === typeof partial ? partial.call(JSCompiler_inline_result$jscomp$0, nextState, JSCompiler_inline_result, void 0) : partial;
							null != partialState$jscomp$0 && (dontMutate ? (dontMutate = !1, nextState = assign({}, nextState, partialState$jscomp$0)) : assign(nextState, partialState$jscomp$0));
						}
						JSCompiler_inline_result$jscomp$0.state = nextState;
					}
				} else internalInstance.queue = null;
			}
			var nextChildren = JSCompiler_inline_result$jscomp$0.render();
			if (request.aborted) throw null;
			var prevKeyPath = task.keyPath;
			task.keyPath = keyPath;
			renderNodeDestructive(request, task, nextChildren, -1);
			task.keyPath = prevKeyPath;
		} else {
			var value = renderWithHooks(request, task, keyPath, type, props, void 0);
			if (request.aborted) throw null;
			finishFunctionComponent(request, task, keyPath, value, 0 !== localIdCounter, actionStateCounter, actionStateMatchingIndex);
		}
		else if ("string" === typeof type) {
			var segment = task.blockedSegment;
			if (null === segment) {
				var children = props.children, prevContext = task.formatContext, prevKeyPath$jscomp$0 = task.keyPath;
				task.formatContext = getChildFormatContext(prevContext, type, props);
				task.keyPath = keyPath;
				renderNode(request, task, children, -1);
				task.formatContext = prevContext;
				task.keyPath = prevKeyPath$jscomp$0;
			} else {
				var children$42 = pushStartInstance(segment.chunks, type, props, request.resumableState, request.renderState, task.blockedPreamble, task.hoistableState, task.formatContext, segment.lastPushedText);
				segment.lastPushedText = !1;
				var prevContext$43 = task.formatContext, prevKeyPath$44 = task.keyPath;
				task.keyPath = keyPath;
				if (3 === (task.formatContext = getChildFormatContext(prevContext$43, type, props)).insertionMode) {
					var preambleSegment = createPendingSegment(request, 0, null, task.formatContext, !1, !1);
					segment.preambleChildren.push(preambleSegment);
					task.blockedSegment = preambleSegment;
					try {
						renderNode(request, task, children$42, -1), preambleSegment.lastPushedText && preambleSegment.textEmbedded && preambleSegment.chunks.push(textSeparator), preambleSegment.status = 1, finishedSegment(request, task.blockedBoundary, preambleSegment);
					} finally {
						task.blockedSegment = segment;
					}
				} else renderNode(request, task, children$42, -1);
				task.formatContext = prevContext$43;
				task.keyPath = prevKeyPath$44;
				a: {
					var target = segment.chunks, resumableState = request.resumableState;
					switch (type) {
						case "title":
						case "style":
						case "script":
						case "area":
						case "base":
						case "br":
						case "col":
						case "embed":
						case "hr":
						case "img":
						case "input":
						case "keygen":
						case "link":
						case "meta":
						case "param":
						case "source":
						case "track":
						case "wbr": break a;
						case "body":
							if (1 >= prevContext$43.insertionMode) {
								resumableState.hasBody = !0;
								break a;
							}
							break;
						case "html":
							if (0 === prevContext$43.insertionMode) {
								resumableState.hasHtml = !0;
								break a;
							}
							break;
						case "head": if (1 >= prevContext$43.insertionMode) break a;
					}
					target.push(endChunkForTag(type));
				}
				segment.lastPushedText = !1;
			}
		} else {
			switch (type) {
				case REACT_LEGACY_HIDDEN_TYPE:
				case REACT_STRICT_MODE_TYPE:
				case REACT_PROFILER_TYPE:
				case REACT_FRAGMENT_TYPE:
					var prevKeyPath$jscomp$1 = task.keyPath;
					task.keyPath = keyPath;
					renderNodeDestructive(request, task, props.children, -1);
					task.keyPath = prevKeyPath$jscomp$1;
					return;
				case REACT_ACTIVITY_TYPE:
					var segment$jscomp$0 = task.blockedSegment;
					if (null === segment$jscomp$0) {
						if ("hidden" !== props.mode) {
							var prevKeyPath$jscomp$2 = task.keyPath;
							task.keyPath = keyPath;
							renderNode(request, task, props.children, -1);
							task.keyPath = prevKeyPath$jscomp$2;
						}
					} else if ("hidden" !== props.mode) {
						segment$jscomp$0.chunks.push(startActivityBoundary);
						segment$jscomp$0.lastPushedText = !1;
						var prevKeyPath$47 = task.keyPath;
						task.keyPath = keyPath;
						renderNode(request, task, props.children, -1);
						task.keyPath = prevKeyPath$47;
						segment$jscomp$0.chunks.push(endActivityBoundary);
						segment$jscomp$0.lastPushedText = !1;
					}
					return;
				case REACT_SUSPENSE_LIST_TYPE:
					a: {
						var children$jscomp$0 = props.children, revealOrder = props.revealOrder;
						if ("independent" !== revealOrder && "together" !== revealOrder) {
							if (isArrayImpl(children$jscomp$0)) {
								renderSuspenseListRows(request, task, keyPath, children$jscomp$0, revealOrder);
								break a;
							}
							var iteratorFn = getIteratorFn(children$jscomp$0);
							if (iteratorFn) {
								var iterator = iteratorFn.call(children$jscomp$0);
								if (iterator) {
									var step = iterator.next();
									if (!step.done) {
										do
											step = iterator.next();
										while (!step.done);
										renderSuspenseListRows(request, task, keyPath, children$jscomp$0, revealOrder);
									}
									break a;
								}
							}
						}
						if ("together" === revealOrder) {
							var prevKeyPath$41 = task.keyPath, prevRow = task.row, newRow = task.row = createSuspenseListRow(null);
							newRow.boundaries = [];
							newRow.together = !0;
							task.keyPath = keyPath;
							renderNodeDestructive(request, task, children$jscomp$0, -1);
							0 === --newRow.pendingTasks && finishSuspenseListRow(request, newRow);
							task.keyPath = prevKeyPath$41;
							task.row = prevRow;
							null !== prevRow && 0 < newRow.pendingTasks && (prevRow.pendingTasks++, newRow.next = prevRow);
						} else {
							var prevKeyPath$jscomp$3 = task.keyPath;
							task.keyPath = keyPath;
							renderNodeDestructive(request, task, children$jscomp$0, -1);
							task.keyPath = prevKeyPath$jscomp$3;
						}
					}
					return;
				case REACT_VIEW_TRANSITION_TYPE:
					var prevContext$jscomp$0 = task.formatContext, prevKeyPath$jscomp$4 = task.keyPath;
					var resumableState$jscomp$0 = request.resumableState;
					if (null != props.name && "auto" !== props.name) var JSCompiler_inline_result$jscomp$2 = props.name;
					else JSCompiler_inline_result$jscomp$2 = makeId(resumableState$jscomp$0, getTreeId(task.treeContext), 0);
					var autoName = JSCompiler_inline_result$jscomp$2, resumableState$jscomp$1 = request.resumableState, update = getViewTransitionClassName(props.default, props.update), enter = getViewTransitionClassName(props.default, props.enter), exit = getViewTransitionClassName(props.default, props.exit), share = getViewTransitionClassName(props.default, props.share), name = props.name;
					update ??= "auto";
					enter ??= "auto";
					exit ??= "auto";
					if (null == name) {
						var parentViewTransition = prevContext$jscomp$0.viewTransition;
						null !== parentViewTransition ? (name = parentViewTransition.name, share = parentViewTransition.share) : (name = "auto", share = "none");
					} else share ??= "auto", prevContext$jscomp$0.tagScope & 4 && (resumableState$jscomp$1.instructions |= 128);
					prevContext$jscomp$0.tagScope & 8 ? resumableState$jscomp$1.instructions |= 128 : exit = "none";
					prevContext$jscomp$0.tagScope & 16 ? resumableState$jscomp$1.instructions |= 128 : enter = "none";
					var viewTransition = {
						update,
						enter,
						exit,
						share,
						parentEnter: "none",
						parentExit: "none",
						name,
						autoName,
						nameIdx: 0
					}, subtreeScope = prevContext$jscomp$0.tagScope & -25;
					subtreeScope = "none" !== update ? subtreeScope | 32 : subtreeScope & -33;
					"none" !== enter && (subtreeScope |= 64);
					task.formatContext = createFormatContext(prevContext$jscomp$0.insertionMode, prevContext$jscomp$0.selectedValue, subtreeScope, viewTransition);
					task.keyPath = keyPath;
					if (null != props.name && "auto" !== props.name) renderNodeDestructive(request, task, props.children, -1);
					else {
						var prevTreeContext = task.treeContext;
						task.treeContext = pushTreeContext(prevTreeContext, 1, 0);
						renderNode(request, task, props.children, -1);
						task.treeContext = prevTreeContext;
					}
					task.formatContext = prevContext$jscomp$0;
					task.keyPath = prevKeyPath$jscomp$4;
					return;
				case REACT_SCOPE_TYPE: throw Error("ReactDOMServer does not yet support scope components.");
				case REACT_SUSPENSE_TYPE:
					a: if (null !== task.replay) {
						var prevKeyPath$27 = task.keyPath, prevContext$28 = task.formatContext, prevRow$29 = task.row;
						task.keyPath = keyPath;
						task.formatContext = getSuspenseContentFormatContext(request.resumableState, prevContext$28);
						task.row = null;
						var content$30 = props.children;
						try {
							renderNode(request, task, content$30, -1);
						} finally {
							task.keyPath = prevKeyPath$27, task.formatContext = prevContext$28, task.row = prevRow$29;
						}
					} else {
						var prevKeyPath$jscomp$5 = task.keyPath, prevContext$jscomp$1 = task.formatContext, prevRow$jscomp$0 = task.row, parentBoundary = task.blockedBoundary, parentPreamble = task.blockedPreamble, parentHoistableState = task.hoistableState, parentSegment = task.blockedSegment, fallback = props.fallback, content = props.children, fallbackAbortSet = /* @__PURE__ */ new Set(), newBoundary = createSuspenseBoundary(request, task.row, fallbackAbortSet, 2 > task.formatContext.insertionMode ? {
							content: createPreambleState(),
							fallback: createPreambleState()
						} : null, !1), boundarySegment = createPendingSegment(request, parentSegment.chunks.length, newBoundary, task.formatContext, !1, !1);
						parentSegment.children.push(boundarySegment);
						parentSegment.lastPushedText = !1;
						var contentRootSegment = createPendingSegment(request, 0, null, task.formatContext, !1, !1);
						contentRootSegment.parentFlushed = !0;
						var trackedPostpones = request.trackedPostpones;
						if (null !== trackedPostpones) {
							var suspenseComponentStack = task.componentStack, fallbackKeyPath = [
								keyPath[0],
								"Suspense Fallback",
								keyPath[2]
							];
							if (null !== trackedPostpones) {
								var fallbackReplayNode = [
									fallbackKeyPath[1],
									fallbackKeyPath[2],
									[],
									null
								];
								trackedPostpones.workingMap.set(fallbackKeyPath, fallbackReplayNode);
								newBoundary.tracked = {
									contentKeyPath: keyPath,
									fallbackNode: fallbackReplayNode
								};
							}
							task.blockedSegment = boundarySegment;
							task.blockedPreamble = null === newBoundary.preamble ? null : newBoundary.preamble.fallback;
							task.keyPath = fallbackKeyPath;
							task.formatContext = getSuspenseFallbackFormatContext(request.resumableState, prevContext$jscomp$1);
							task.componentStack = replaceSuspenseComponentStackWithSuspenseFallbackStack(suspenseComponentStack);
							try {
								renderNode(request, task, fallback, -1), boundarySegment.lastPushedText && boundarySegment.textEmbedded && boundarySegment.chunks.push(textSeparator), boundarySegment.status = 1, finishedSegment(request, parentBoundary, boundarySegment);
							} catch (thrownValue) {
								throw boundarySegment.status = request.aborted ? 3 : 4, thrownValue;
							} finally {
								task.blockedSegment = parentSegment, task.blockedPreamble = parentPreamble, task.keyPath = prevKeyPath$jscomp$5, task.formatContext = prevContext$jscomp$1;
							}
							var suspendedPrimaryTask = createRenderTask(request, null, content, -1, newBoundary, contentRootSegment, null === newBoundary.preamble ? null : newBoundary.preamble.content, newBoundary.contentState, task.abortSet, keyPath, getSuspenseContentFormatContext(request.resumableState, task.formatContext), task.context, task.treeContext, null, suspenseComponentStack);
							pushComponentStack(suspendedPrimaryTask);
							request.pingedTasks.push(suspendedPrimaryTask);
						} else {
							task.blockedBoundary = newBoundary;
							task.blockedPreamble = null === newBoundary.preamble ? null : newBoundary.preamble.content;
							task.hoistableState = newBoundary.contentState;
							task.blockedSegment = contentRootSegment;
							task.keyPath = keyPath;
							task.formatContext = getSuspenseContentFormatContext(request.resumableState, prevContext$jscomp$1);
							task.row = null;
							try {
								if (renderNode(request, task, content, -1), contentRootSegment.lastPushedText && contentRootSegment.textEmbedded && contentRootSegment.chunks.push(textSeparator), contentRootSegment.status = 1, finishedSegment(request, newBoundary, contentRootSegment), queueCompletedSegment(newBoundary, contentRootSegment), 0 === newBoundary.pendingTasks && 0 === newBoundary.status) {
									if (newBoundary.status = 1, !isEligibleForOutlining(request, newBoundary)) {
										null !== prevRow$jscomp$0 && 0 === --prevRow$jscomp$0.pendingTasks && finishSuspenseListRow(request, prevRow$jscomp$0);
										0 === request.pendingRootTasks && task.blockedPreamble && preparePreamble(request);
										break a;
									}
								} else null !== prevRow$jscomp$0 && prevRow$jscomp$0.together && tryToResolveTogetherRow(request, prevRow$jscomp$0);
							} catch (thrownValue$31) {
								newBoundary.status = 4;
								if (request.aborted) {
									contentRootSegment.status = 3;
									var error = request.fatalError;
								} else contentRootSegment.status = 4, error = thrownValue$31;
								var thrownInfo = getThrownInfo(task.componentStack);
								newBoundary.errorDigest = logRecoverableError(request, error, thrownInfo);
								untrackBoundary(request, newBoundary);
							} finally {
								task.blockedBoundary = parentBoundary, task.blockedPreamble = parentPreamble, task.hoistableState = parentHoistableState, task.blockedSegment = parentSegment, task.keyPath = prevKeyPath$jscomp$5, task.formatContext = prevContext$jscomp$1, task.row = prevRow$jscomp$0;
							}
							var suspendedFallbackTask = createRenderTask(request, null, fallback, -1, parentBoundary, boundarySegment, null === newBoundary.preamble ? null : newBoundary.preamble.fallback, newBoundary.fallbackState, fallbackAbortSet, [
								keyPath[0],
								"Suspense Fallback",
								keyPath[2]
							], getSuspenseFallbackFormatContext(request.resumableState, task.formatContext), task.context, task.treeContext, task.row, replaceSuspenseComponentStackWithSuspenseFallbackStack(task.componentStack));
							pushComponentStack(suspendedFallbackTask);
							request.pingedTasks.push(suspendedFallbackTask);
						}
					}
					return;
			}
			if ("object" === typeof type && null !== type) switch (type.$$typeof) {
				case REACT_FORWARD_REF_TYPE:
					if ("ref" in props) {
						var propsWithoutRef = {};
						for (var key in props) "ref" !== key && (propsWithoutRef[key] = props[key]);
					} else propsWithoutRef = props;
					finishFunctionComponent(request, task, keyPath, renderWithHooks(request, task, keyPath, type.render, propsWithoutRef, ref), 0 !== localIdCounter, actionStateCounter, actionStateMatchingIndex);
					return;
				case REACT_MEMO_TYPE:
					renderElement(request, task, keyPath, type.type, props, ref);
					return;
				case REACT_CONTEXT_TYPE:
					var children$jscomp$2 = props.children, prevKeyPath$jscomp$6 = task.keyPath, nextValue = props.value;
					var prevValue = type._currentValue;
					type._currentValue = nextValue;
					var prevNode = currentActiveSnapshot, newNode = {
						parent: prevNode,
						depth: null === prevNode ? 0 : prevNode.depth + 1,
						context: type,
						parentValue: prevValue,
						value: nextValue
					};
					currentActiveSnapshot = newNode;
					task.context = newNode;
					task.keyPath = keyPath;
					renderNodeDestructive(request, task, children$jscomp$2, -1);
					var prevSnapshot = currentActiveSnapshot;
					if (null === prevSnapshot) throw Error("Tried to pop a Context at the root of the app. This is a bug in React.");
					prevSnapshot.context._currentValue = prevSnapshot.parentValue;
					task.context = currentActiveSnapshot = prevSnapshot.parent;
					task.keyPath = prevKeyPath$jscomp$6;
					return;
				case REACT_CONSUMER_TYPE:
					var render = props.children, newChildren = render(type._context._currentValue), prevKeyPath$jscomp$7 = task.keyPath;
					task.keyPath = keyPath;
					renderNodeDestructive(request, task, newChildren, -1);
					task.keyPath = prevKeyPath$jscomp$7;
					return;
				case REACT_LAZY_TYPE:
					var init = type._init;
					var Component = init(type._payload);
					if (request.aborted) throw null;
					renderElement(request, task, keyPath, Component, props, ref);
					return;
			}
			throw Error("Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: " + ((null == type ? type : typeof type) + "."));
		}
	}
	function resumeNode(request, task, segmentId, node, childIndex) {
		var prevReplay = task.replay, blockedBoundary = task.blockedBoundary, resumedSegment = createPendingSegment(request, 0, null, task.formatContext, !1, !1);
		resumedSegment.id = segmentId;
		resumedSegment.parentFlushed = !0;
		try {
			task.replay = null, task.blockedSegment = resumedSegment, renderNode(request, task, node, childIndex), resumedSegment.status = 1, finishedSegment(request, blockedBoundary, resumedSegment), null === blockedBoundary ? request.completedRootSegment = resumedSegment : (queueCompletedSegment(blockedBoundary, resumedSegment), blockedBoundary.parentFlushed && request.partialBoundaries.push(blockedBoundary));
		} finally {
			task.replay = prevReplay, task.blockedSegment = null;
		}
	}
	function renderNodeDestructive(request, task, node, childIndex) {
		null !== task.replay && "number" === typeof task.replay.slots ? resumeNode(request, task, task.replay.slots, node, childIndex) : (task.node = node, task.childIndex = childIndex, node = task.componentStack, pushComponentStack(task), retryNode(request, task), task.componentStack = node);
	}
	function retryNode(request, task) {
		var node = task.node, childIndex = task.childIndex;
		if (null !== node) {
			if ("object" === typeof node) {
				switch (node.$$typeof) {
					case REACT_ELEMENT_TYPE:
						var type = node.type, key = node.key, props = node.props;
						node = props.ref;
						var ref = void 0 !== node ? node : null, name = getComponentNameFromType(type), keyOrIndex = null == key || key === REACT_OPTIMISTIC_KEY ? -1 === childIndex ? 0 : childIndex : key;
						key = [
							task.keyPath,
							name,
							keyOrIndex
						];
						if (null !== task.replay) a: {
							var replay = task.replay;
							childIndex = replay.nodes;
							for (node = 0; node < childIndex.length; node++) {
								var node$jscomp$0 = childIndex[node];
								if (keyOrIndex === node$jscomp$0[1]) {
									if (4 === node$jscomp$0.length) {
										if (null !== name && name !== node$jscomp$0[0]) throw Error("Expected the resume to render <" + node$jscomp$0[0] + "> in this slot but instead it rendered <" + name + ">. The tree doesn't match so React will fallback to client rendering.");
										var childNodes = node$jscomp$0[2], childSlots = node$jscomp$0[3], currentNode = task.node;
										task.replay = {
											nodes: childNodes,
											slots: childSlots,
											pendingTasks: 1
										};
										try {
											renderElement(request, task, key, type, props, ref);
											if (1 === task.replay.pendingTasks && 0 < task.replay.nodes.length) throw Error("Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering.");
											task.replay.pendingTasks--;
										} catch (x) {
											if ("object" === typeof x && null !== x && (x === SuspenseException || "function" === typeof x.then || "Maximum call stack size exceeded" === x.message)) throw task.node === currentNode ? task.replay = replay : childIndex.splice(node, 1), x;
											task.replay.pendingTasks--;
											key = getThrownInfo(task.componentStack);
											currentNode = request;
											props = task.blockedBoundary;
											request = request.aborted ? request.fatalError : x;
											key = logRecoverableError(currentNode, request, key);
											abortRemainingReplayNodes(currentNode, props, childNodes, childSlots, request, key);
										}
										task.replay = replay;
									} else {
										if (type !== REACT_SUSPENSE_TYPE) throw Error("Expected the resume to render <Suspense> in this slot but instead it rendered <" + (getComponentNameFromType(type) || "Unknown") + ">. The tree doesn't match so React will fallback to client rendering.");
										b: {
											replay = node$jscomp$0[5];
											type = node$jscomp$0[2];
											ref = node$jscomp$0[3];
											name = null === node$jscomp$0[4] ? [] : node$jscomp$0[4][2];
											node$jscomp$0 = null === node$jscomp$0[4] ? null : node$jscomp$0[4][3];
											keyOrIndex = task.keyPath;
											var prevContext = task.formatContext, prevRow = task.row, previousReplaySet = task.replay, parentBoundary = task.blockedBoundary, parentHoistableState = task.hoistableState, content = props.children;
											props = props.fallback;
											var fallbackAbortSet = /* @__PURE__ */ new Set(), resumedBoundary = createSuspenseBoundary(request, task.row, fallbackAbortSet, 2 > task.formatContext.insertionMode ? {
												content: createPreambleState(),
												fallback: createPreambleState()
											} : null, !1);
											resumedBoundary.parentFlushed = !0;
											resumedBoundary.rootSegmentID = replay;
											task.blockedBoundary = resumedBoundary;
											task.hoistableState = resumedBoundary.contentState;
											task.keyPath = key;
											task.formatContext = getSuspenseContentFormatContext(request.resumableState, prevContext);
											task.row = null;
											task.replay = {
												nodes: type,
												slots: ref,
												pendingTasks: 1
											};
											try {
												renderNode(request, task, content, -1);
												if (1 === task.replay.pendingTasks && 0 < task.replay.nodes.length) throw Error("Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering.");
												task.replay.pendingTasks--;
												if (0 === resumedBoundary.pendingTasks && 0 === resumedBoundary.status) {
													resumedBoundary.status = 1;
													request.completedBoundaries.push(resumedBoundary);
													break b;
												}
											} catch (thrownValue) {
												resumedBoundary.status = 4, childNodes = request.aborted ? request.fatalError : thrownValue, childSlots = getThrownInfo(task.componentStack), currentNode = logRecoverableError(request, childNodes, childSlots), resumedBoundary.errorDigest = currentNode, task.replay.pendingTasks--, request.clientRenderedBoundaries.push(resumedBoundary);
											} finally {
												task.blockedBoundary = parentBoundary, task.hoistableState = parentHoistableState, task.replay = previousReplaySet, task.keyPath = keyOrIndex, task.formatContext = prevContext, task.row = prevRow;
											}
											childNodes = createReplayTask(request, null, {
												nodes: name,
												slots: node$jscomp$0,
												pendingTasks: 0
											}, props, -1, parentBoundary, resumedBoundary.fallbackState, fallbackAbortSet, [
												key[0],
												"Suspense Fallback",
												key[2]
											], getSuspenseFallbackFormatContext(request.resumableState, task.formatContext), task.context, task.treeContext, task.row, replaceSuspenseComponentStackWithSuspenseFallbackStack(task.componentStack));
											pushComponentStack(childNodes);
											request.pingedTasks.push(childNodes);
										}
									}
									childIndex.splice(node, 1);
									break a;
								}
							}
						}
						else renderElement(request, task, key, type, props, ref);
						return;
					case REACT_PORTAL_TYPE: throw Error("Portals are not currently supported by the server renderer. Render them conditionally so that they only appear on the client render.");
					case REACT_LAZY_TYPE:
						childNodes = node._init;
						node = childNodes(node._payload);
						if (request.aborted) throw null;
						renderNodeDestructive(request, task, node, childIndex);
						return;
				}
				if (isArrayImpl(node)) {
					renderChildrenArray(request, task, node, childIndex);
					return;
				}
				if (childNodes = getIteratorFn(node)) {
					if (childNodes = childNodes.call(node)) {
						node = childNodes.next();
						if (!node.done) {
							childSlots = [];
							do
								childSlots.push(node.value), node = childNodes.next();
							while (!node.done);
							renderChildrenArray(request, task, childSlots, childIndex);
						}
						return;
					}
				}
				if ("function" === typeof node.then) return task.thenableState = null, renderNodeDestructive(request, task, unwrapThenable(node), childIndex);
				if (node.$$typeof === REACT_CONTEXT_TYPE) return renderNodeDestructive(request, task, node._currentValue, childIndex);
				childIndex = Object.prototype.toString.call(node);
				throw Error("Objects are not valid as a React child (found: " + ("[object Object]" === childIndex ? "object with keys {" + Object.keys(node).join(", ") + "}" : childIndex) + "). If you meant to render a collection of children, use an array instead.");
			}
			if ("string" === typeof node) childIndex = task.blockedSegment, null !== childIndex && (childIndex.lastPushedText = pushTextInstance(childIndex.chunks, node, request.renderState, childIndex.lastPushedText));
			else if ("number" === typeof node || "bigint" === typeof node) childIndex = task.blockedSegment, null !== childIndex && (childIndex.lastPushedText = pushTextInstance(childIndex.chunks, "" + node, request.renderState, childIndex.lastPushedText));
		}
	}
	function renderChildrenArray(request, task, children, childIndex) {
		var prevKeyPath = task.keyPath;
		if (-1 !== childIndex && (task.keyPath = [
			task.keyPath,
			"Fragment",
			childIndex
		], null !== task.replay)) {
			for (var replay = task.replay, replayNodes = replay.nodes, j = 0; j < replayNodes.length; j++) {
				var node = replayNodes[j];
				if (node[1] === childIndex) {
					childIndex = node[2];
					node = node[3];
					task.replay = {
						nodes: childIndex,
						slots: node,
						pendingTasks: 1
					};
					try {
						renderChildrenArray(request, task, children, -1);
						if (1 === task.replay.pendingTasks && 0 < task.replay.nodes.length) throw Error("Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering.");
						task.replay.pendingTasks--;
					} catch (x) {
						if ("object" === typeof x && null !== x && (x === SuspenseException || "function" === typeof x.then)) throw x;
						task.replay.pendingTasks--;
						var thrownInfo = getThrownInfo(task.componentStack);
						children = request;
						var boundary = task.blockedBoundary;
						request = request.aborted ? request.fatalError : x;
						thrownInfo = logRecoverableError(children, request, thrownInfo);
						abortRemainingReplayNodes(children, boundary, childIndex, node, request, thrownInfo);
					}
					task.replay = replay;
					replayNodes.splice(j, 1);
					break;
				}
			}
			task.keyPath = prevKeyPath;
			return;
		}
		replay = task.treeContext;
		replayNodes = children.length;
		if (null !== task.replay && (j = task.replay.slots, null !== j && "object" === typeof j)) {
			for (childIndex = 0; childIndex < replayNodes; childIndex++) node = children[childIndex], task.treeContext = pushTreeContext(replay, replayNodes, childIndex), boundary = j[childIndex], "number" === typeof boundary ? (resumeNode(request, task, boundary, node, childIndex), delete j[childIndex]) : renderNode(request, task, node, childIndex);
			task.treeContext = replay;
			task.keyPath = prevKeyPath;
			return;
		}
		for (j = 0; j < replayNodes; j++) childIndex = children[j], task.treeContext = pushTreeContext(replay, replayNodes, j), renderNode(request, task, childIndex, j);
		task.treeContext = replay;
		task.keyPath = prevKeyPath;
	}
	function trackPostponedBoundary(request, trackedPostpones, boundary) {
		boundary.status = 5;
		boundary.rootSegmentID = request.nextSegmentId++;
		var tracked = boundary.tracked;
		if (null === tracked) throw Error("It should not be possible to postpone at the root. This is a bug in React.");
		request = tracked.contentKeyPath;
		if (null === request) throw Error("It should not be possible to postpone at the root. This is a bug in React.");
		tracked = tracked.fallbackNode;
		var children = [], boundaryNode = trackedPostpones.workingMap.get(request);
		if (void 0 === boundaryNode) return boundary = [
			request[1],
			request[2],
			children,
			null,
			tracked,
			boundary.rootSegmentID
		], trackedPostpones.workingMap.set(request, boundary), addToReplayParent(boundary, request[0], trackedPostpones), boundary;
		boundaryNode[4] = tracked;
		boundaryNode[5] = boundary.rootSegmentID;
		return boundaryNode;
	}
	function trackPostpone(request, trackedPostpones, task, segment) {
		segment.status = 5;
		var keyPath = task.keyPath, boundary = task.blockedBoundary;
		if (null === boundary) segment.id = request.nextSegmentId++, trackedPostpones.rootSlots = segment.id, null !== request.completedRootSegment && (request.completedRootSegment.status = 5);
		else {
			if (null !== boundary && 0 === boundary.status) {
				var boundaryNode = trackPostponedBoundary(request, trackedPostpones, boundary);
				if (null !== boundary.tracked && boundary.tracked.contentKeyPath === keyPath && -1 === task.childIndex) {
					-1 === segment.id && (segment.id = segment.parentFlushed ? boundary.rootSegmentID : request.nextSegmentId++);
					boundaryNode[3] = segment.id;
					return;
				}
			}
			-1 === segment.id && (segment.id = segment.parentFlushed && null !== boundary ? boundary.rootSegmentID : request.nextSegmentId++);
			if (-1 === task.childIndex) null === keyPath ? trackedPostpones.rootSlots = segment.id : (task = trackedPostpones.workingMap.get(keyPath), void 0 === task ? (task = [
				keyPath[1],
				keyPath[2],
				[],
				segment.id
			], addToReplayParent(task, keyPath[0], trackedPostpones)) : task[3] = segment.id);
			else {
				if (null === keyPath) {
					if (request = trackedPostpones.rootSlots, null === request) request = trackedPostpones.rootSlots = {};
					else if ("number" === typeof request) throw Error("It should not be possible to postpone both at the root of an element as well as a slot below. This is a bug in React.");
				} else if (boundary = trackedPostpones.workingMap, boundaryNode = boundary.get(keyPath), void 0 === boundaryNode) request = {}, boundaryNode = [
					keyPath[1],
					keyPath[2],
					[],
					request
				], boundary.set(keyPath, boundaryNode), addToReplayParent(boundaryNode, keyPath[0], trackedPostpones);
				else if (request = boundaryNode[3], null === request) request = boundaryNode[3] = {};
				else if ("number" === typeof request) throw Error("It should not be possible to postpone both at the root of an element as well as a slot below. This is a bug in React.");
				request[task.childIndex] = segment.id;
			}
		}
	}
	function untrackBoundary(request, boundary) {
		request = request.trackedPostpones;
		null !== request && (boundary = boundary.tracked, null !== boundary && (boundary = boundary.contentKeyPath, null !== boundary && (request = request.workingMap.get(boundary), void 0 !== request && (request.length = 4, request[2] = [], request[3] = null))));
	}
	function spawnNewSuspendedReplayTask(request, task, thenableState) {
		return createReplayTask(request, thenableState, task.replay, task.node, task.childIndex, task.blockedBoundary, task.hoistableState, task.abortSet, task.keyPath, task.formatContext, task.context, task.treeContext, task.row, task.componentStack);
	}
	function spawnNewSuspendedRenderTask(request, task, thenableState) {
		var segment = task.blockedSegment, newSegment = createPendingSegment(request, segment.chunks.length, null, task.formatContext, segment.lastPushedText, !0);
		segment.children.push(newSegment);
		segment.lastPushedText = !1;
		return createRenderTask(request, thenableState, task.node, task.childIndex, task.blockedBoundary, newSegment, task.blockedPreamble, task.hoistableState, task.abortSet, task.keyPath, task.formatContext, task.context, task.treeContext, task.row, task.componentStack);
	}
	function renderNode(request, task, node, childIndex) {
		var previousFormatContext = task.formatContext, previousContext = task.context, previousKeyPath = task.keyPath, previousTreeContext = task.treeContext, previousComponentStack = task.componentStack, segment = task.blockedSegment;
		if (null === segment) {
			segment = task.replay;
			try {
				return renderNodeDestructive(request, task, node, childIndex);
			} catch (thrownValue) {
				if (resetHooksState(), node = thrownValue === SuspenseException ? getSuspendedThenable() : thrownValue, !request.aborted && "object" === typeof node && null !== node) {
					if ("function" === typeof node.then) {
						childIndex = thrownValue === SuspenseException ? getThenableStateAfterSuspending() : null;
						request = spawnNewSuspendedReplayTask(request, task, childIndex).ping;
						node.then(request.resolve, request.reject);
						task.formatContext = previousFormatContext;
						task.context = previousContext;
						task.keyPath = previousKeyPath;
						task.treeContext = previousTreeContext;
						task.componentStack = previousComponentStack;
						task.replay = segment;
						switchContext(previousContext);
						return;
					}
					if ("Maximum call stack size exceeded" === node.message) {
						node = thrownValue === SuspenseException ? getThenableStateAfterSuspending() : null;
						node = spawnNewSuspendedReplayTask(request, task, node);
						request.pingedTasks.push(node);
						task.formatContext = previousFormatContext;
						task.context = previousContext;
						task.keyPath = previousKeyPath;
						task.treeContext = previousTreeContext;
						task.componentStack = previousComponentStack;
						task.replay = segment;
						switchContext(previousContext);
						return;
					}
				}
			}
		} else {
			var childrenLength = segment.children.length, chunkLength = segment.chunks.length;
			try {
				return renderNodeDestructive(request, task, node, childIndex);
			} catch (thrownValue$64) {
				if (resetHooksState(), segment.children.length = childrenLength, segment.chunks.length = chunkLength, node = thrownValue$64 === SuspenseException ? getSuspendedThenable() : thrownValue$64, !request.aborted && "object" === typeof node && null !== node) {
					if ("function" === typeof node.then) {
						segment = node;
						node = thrownValue$64 === SuspenseException ? getThenableStateAfterSuspending() : null;
						request = spawnNewSuspendedRenderTask(request, task, node).ping;
						segment.then(request.resolve, request.reject);
						task.formatContext = previousFormatContext;
						task.context = previousContext;
						task.keyPath = previousKeyPath;
						task.treeContext = previousTreeContext;
						task.componentStack = previousComponentStack;
						switchContext(previousContext);
						return;
					}
					if ("Maximum call stack size exceeded" === node.message) {
						segment = thrownValue$64 === SuspenseException ? getThenableStateAfterSuspending() : null;
						segment = spawnNewSuspendedRenderTask(request, task, segment);
						request.pingedTasks.push(segment);
						task.formatContext = previousFormatContext;
						task.context = previousContext;
						task.keyPath = previousKeyPath;
						task.treeContext = previousTreeContext;
						task.componentStack = previousComponentStack;
						switchContext(previousContext);
						return;
					}
				}
			}
		}
		task.formatContext = previousFormatContext;
		task.context = previousContext;
		task.keyPath = previousKeyPath;
		task.treeContext = previousTreeContext;
		switchContext(previousContext);
		throw node;
	}
	function abortTaskSoft(task) {
		var boundary = task.blockedBoundary, segment = task.blockedSegment;
		null !== segment && (segment.status = 3, finishedTask(this, boundary, task.row, segment));
	}
	function abortRemainingReplayNodes(request$jscomp$0, boundary, nodes, slots, error, errorDigest$jscomp$0) {
		for (var i = 0; i < nodes.length; i++) {
			var node = nodes[i];
			if (4 === node.length) abortRemainingReplayNodes(request$jscomp$0, boundary, node[2], node[3], error, errorDigest$jscomp$0);
			else {
				node = node[5];
				var request = request$jscomp$0, errorDigest = errorDigest$jscomp$0, resumedBoundary = createSuspenseBoundary(request, null, /* @__PURE__ */ new Set(), null, !1);
				resumedBoundary.parentFlushed = !0;
				resumedBoundary.rootSegmentID = node;
				resumedBoundary.status = 4;
				resumedBoundary.errorDigest = errorDigest;
				resumedBoundary.parentFlushed && request.clientRenderedBoundaries.push(resumedBoundary);
			}
		}
		nodes.length = 0;
		if (null !== slots) {
			if (null === boundary) throw Error("We should not have any resumable nodes in the shell. This is a bug in React.");
			4 !== boundary.status && (boundary.status = 4, boundary.errorDigest = errorDigest$jscomp$0, boundary.parentFlushed && request$jscomp$0.clientRenderedBoundaries.push(boundary));
			if ("object" === typeof slots) for (var index in slots) delete slots[index];
		}
	}
	function abortTask(task, request) {
		if (task !== request.currentTask) {
			var boundary = task.blockedBoundary;
			task = task.blockedSegment;
			null !== task && (task.status = 3);
			null !== boundary && boundary.fallbackAbortableTasks.forEach(function(fallbackTask) {
				return abortTask(fallbackTask, request);
			});
		}
	}
	function finishAbortedTask(task, request, error) {
		if (task !== request.currentTask) {
			var boundary = task.blockedBoundary, segment = task.blockedSegment;
			if (null === segment || 3 === segment.status) {
				var errorInfo = getThrownInfo(task.componentStack), isRecoverableReason = isRecoverableError(error);
				if (null === boundary) {
					boundary = task.replay;
					if (null === boundary) {
						isRecoverableReason || null === request.trackedPostpones || null === segment ? isRecoverableReason ? (task = cloneRecoverableErrorAsFatal(error), logRecoverableError(request, task, errorInfo), 12 !== request.status && 13 !== request.status && fatalError(request, task)) : (logRecoverableError(request, error, errorInfo), 12 !== request.status && 13 !== request.status && fatalError(request, error)) : (boundary = request.trackedPostpones, logRecoverableError(request, error, errorInfo), trackPostpone(request, boundary, task, segment), finishedTask(request, null, task.row, segment));
						return;
					}
					12 !== request.status && 13 !== request.status && (boundary.pendingTasks--, 0 === boundary.pendingTasks && 0 < boundary.nodes.length && (errorInfo = logRecoverableError(request, error, errorInfo), abortRemainingReplayNodes(request, null, boundary.nodes, boundary.slots, error, errorInfo)), request.pendingRootTasks--, 0 === request.pendingRootTasks && completeShell(request));
				} else {
					var trackedPostpones$65 = request.trackedPostpones;
					if (4 !== boundary.status) {
						if (!isRecoverableReason && null !== trackedPostpones$65 && null !== segment) return logRecoverableError(request, error, errorInfo), trackPostpone(request, trackedPostpones$65, task, segment), boundary.fallbackAbortableTasks.forEach(function(fallbackTask) {
							return finishAbortedTask(fallbackTask, request, error);
						}), boundary.fallbackAbortableTasks.clear(), finishedTask(request, boundary, task.row, segment);
						boundary.status = 4;
						errorInfo = logRecoverableError(request, error, errorInfo);
						boundary.errorDigest = errorInfo;
						untrackBoundary(request, boundary);
						boundary.parentFlushed && request.clientRenderedBoundaries.push(boundary);
					}
					boundary.pendingTasks--;
					errorInfo = boundary.row;
					null !== errorInfo && 0 === --errorInfo.pendingTasks && finishSuspenseListRow(request, errorInfo);
					boundary.fallbackAbortableTasks.forEach(function(fallbackTask) {
						return finishAbortedTask(fallbackTask, request, error);
					});
					boundary.fallbackAbortableTasks.clear();
				}
				task = task.row;
				null !== task && 0 === --task.pendingTasks && finishSuspenseListRow(request, task);
				request.allPendingTasks--;
				0 === request.allPendingTasks && completeAll(request);
			}
		}
	}
	function safelyEmitEarlyPreloads(request, shellComplete) {
		try {
			var renderState = request.renderState, onHeaders = renderState.onHeaders;
			if (onHeaders) {
				var headers = renderState.headers;
				if (headers) {
					renderState.headers = null;
					var linkHeader = headers.preconnects;
					headers.fontPreloads && (linkHeader && (linkHeader += ", "), linkHeader += headers.fontPreloads);
					headers.highImagePreloads && (linkHeader && (linkHeader += ", "), linkHeader += headers.highImagePreloads);
					if (!shellComplete) {
						var queueIter = renderState.styles.values(), queueStep = queueIter.next();
						b: for (; 0 < headers.remainingCapacity && !queueStep.done; queueStep = queueIter.next()) for (var sheetIter = queueStep.value.sheets.values(), sheetStep = sheetIter.next(); 0 < headers.remainingCapacity && !sheetStep.done; sheetStep = sheetIter.next()) {
							var sheet = sheetStep.value, props = sheet.props, key = props.href, props$jscomp$0 = sheet.props, header = getPreloadAsHeader(props$jscomp$0.href, "style", {
								crossOrigin: props$jscomp$0.crossOrigin,
								integrity: props$jscomp$0.integrity,
								nonce: props$jscomp$0.nonce,
								type: props$jscomp$0.type,
								fetchPriority: props$jscomp$0.fetchPriority,
								referrerPolicy: props$jscomp$0.referrerPolicy,
								media: props$jscomp$0.media
							});
							if (0 <= (headers.remainingCapacity -= header.length + 2)) renderState.resets.style[key] = PRELOAD_NO_CREDS, linkHeader && (linkHeader += ", "), linkHeader += header, renderState.resets.style[key] = "string" === typeof props.crossOrigin || "string" === typeof props.integrity ? [props.crossOrigin, props.integrity] : PRELOAD_NO_CREDS;
							else break b;
						}
					}
					linkHeader ? onHeaders({ Link: linkHeader }) : onHeaders({});
				}
			}
		} catch (error) {
			logRecoverableError(request, error, {});
		}
	}
	function completeShell(request) {
		null === request.trackedPostpones && safelyEmitEarlyPreloads(request, !0);
		null === request.trackedPostpones && preparePreamble(request);
		request = request.onShellReady;
		request();
	}
	function completeAll(request) {
		safelyEmitEarlyPreloads(request, null === request.trackedPostpones ? !0 : null === request.completedRootSegment || 5 !== request.completedRootSegment.status);
		preparePreamble(request);
		request = request.onAllReady;
		request();
	}
	function queueCompletedSegment(boundary, segment) {
		if (0 === segment.chunks.length && 1 === segment.children.length && null === segment.children[0].boundary && -1 === segment.children[0].id) {
			var childSegment = segment.children[0];
			childSegment.id = segment.id;
			childSegment.parentFlushed = !0;
			1 !== childSegment.status && 3 !== childSegment.status && 4 !== childSegment.status || queueCompletedSegment(boundary, childSegment);
		} else boundary.completedSegments.push(segment);
	}
	function finishedSegment(request, boundary, segment) {
		if (null !== byteLengthOfChunk) {
			segment = segment.chunks;
			for (var segmentByteSize = 0, i = 0; i < segment.length; i++) segmentByteSize += byteLengthOfChunk(segment[i]);
			null === boundary ? request.byteSize += segmentByteSize : boundary.byteSize += segmentByteSize;
		}
	}
	function finishedTask(request, boundary, row, segment) {
		null !== row && (0 === --row.pendingTasks ? finishSuspenseListRow(request, row) : row.together && tryToResolveTogetherRow(request, row));
		request.allPendingTasks--;
		if (null === boundary) {
			if (null !== segment && segment.parentFlushed) {
				if (null !== request.completedRootSegment) throw Error("There can only be one root segment. This is a bug in React.");
				request.completedRootSegment = segment;
			}
			request.pendingRootTasks--;
			0 === request.pendingRootTasks && completeShell(request);
		} else if (boundary.pendingTasks--, 4 !== boundary.status) if (0 === boundary.pendingTasks) {
			if (0 === boundary.status && (boundary.status = 1), null !== segment && segment.parentFlushed && (1 === segment.status || 3 === segment.status) && queueCompletedSegment(boundary, segment), boundary.parentFlushed && request.completedBoundaries.push(boundary), 1 === boundary.status) row = boundary.row, null !== row && hoistHoistables(row.hoistables, boundary.contentState), isEligibleForOutlining(request, boundary) || (request.allPendingTasks++, boundary.fallbackAbortableTasks.forEach(abortTaskSoft, request), boundary.fallbackAbortableTasks.clear(), null !== row && 0 === --row.pendingTasks && finishSuspenseListRow(request, row), request.allPendingTasks--), 0 === request.pendingRootTasks && null === request.trackedPostpones && null !== boundary.preamble && preparePreamble(request);
			else if (5 === boundary.status && (boundary = boundary.row, null !== boundary)) {
				if (null !== request.trackedPostpones) {
					row = request.trackedPostpones;
					var postponedRow = boundary.next;
					if (null !== postponedRow && (segment = postponedRow.boundaries, null !== segment)) for (postponedRow.boundaries = null, postponedRow = 0; postponedRow < segment.length; postponedRow++) {
						var postponedBoundary = segment[postponedRow];
						trackPostponedBoundary(request, row, postponedBoundary);
						finishedTask(request, postponedBoundary, null, null);
					}
				}
				request.allPendingTasks++;
				0 === --boundary.pendingTasks && finishSuspenseListRow(request, boundary);
				request.allPendingTasks--;
			}
		} else null === segment || !segment.parentFlushed || 1 !== segment.status && 3 !== segment.status || (queueCompletedSegment(boundary, segment), 1 === boundary.completedSegments.length && boundary.parentFlushed && request.partialBoundaries.push(boundary)), boundary = boundary.row, null !== boundary && boundary.together && tryToResolveTogetherRow(request, boundary);
		0 === request.allPendingTasks && completeAll(request);
	}
	function performWork(request$jscomp$1) {
		if (!(request$jscomp$1.aborted || 11 < request$jscomp$1.status)) {
			var prevContext = currentActiveSnapshot, prevDispatcher = ReactSharedInternals.H;
			ReactSharedInternals.H = HooksDispatcher;
			var prevAsyncDispatcher = ReactSharedInternals.A;
			ReactSharedInternals.A = DefaultAsyncDispatcher;
			var prevRequest = currentRequest;
			currentRequest = request$jscomp$1;
			var prevResumableState = currentResumableState;
			currentResumableState = request$jscomp$1.resumableState;
			try {
				var pingedTasks = request$jscomp$1.pingedTasks, i = 0;
				for (; i < pingedTasks.length; i++) {
					var task = pingedTasks[i], request = request$jscomp$1, segment = task.blockedSegment;
					if (null === segment) {
						a: if (0 !== task.replay.pendingTasks) {
							var prevTask = request.currentTask;
							request.currentTask = task;
							switchContext(task.context);
							var startNode = task.node;
							try {
								"number" === typeof task.replay.slots ? resumeNode(request, task, task.replay.slots, task.node, task.childIndex) : retryNode(request, task);
								if (1 === task.replay.pendingTasks && 0 < task.replay.nodes.length) throw Error("Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering.");
								task.replay.pendingTasks--;
								task.abortSet.delete(task);
								finishedTask(request, task.blockedBoundary, task.row, null);
							} catch (thrownValue) {
								resetHooksState();
								var x = thrownValue === SuspenseException ? getSuspendedThenable() : thrownValue;
								if (request.aborted) {
									thrownValue === SuspenseException && (task.thenableState = getThenableStateAfterSuspending());
									request.currentTask = prevTask;
									var request$jscomp$0 = request;
									abortTask(task, request$jscomp$0);
									task.abortSet.delete(task);
									finishAbortedTask(task, request$jscomp$0, request$jscomp$0.fatalError);
								} else {
									if ("object" === typeof x && null !== x) {
										if ("function" === typeof x.then) {
											var ping = task.ping;
											x.then(ping.resolve, ping.reject);
											task.thenableState = thrownValue === SuspenseException ? getThenableStateAfterSuspending() : null;
											break a;
										}
										if ("Maximum call stack size exceeded" === x.message && task.node !== startNode) {
											task.thenableState = null;
											request.pingedTasks.push(task);
											break a;
										}
									}
									task.replay.pendingTasks--;
									task.abortSet.delete(task);
									var errorInfo = getThrownInfo(task.componentStack);
									request$jscomp$0 = request;
									var boundary = task.blockedBoundary, error$jscomp$0 = request.aborted ? request.fatalError : x, replayNodes = task.replay.nodes, resumeSlots = task.replay.slots, errorDigest = logRecoverableError(request$jscomp$0, error$jscomp$0, errorInfo);
									abortRemainingReplayNodes(request$jscomp$0, boundary, replayNodes, resumeSlots, error$jscomp$0, errorDigest);
									request.pendingRootTasks--;
									0 === request.pendingRootTasks && completeShell(request);
									request.allPendingTasks--;
									0 === request.allPendingTasks && completeAll(request);
								}
							} finally {
								request.currentTask = prevTask;
							}
						}
					} else a: if (request$jscomp$0 = segment, 0 === request$jscomp$0.status) {
						var prevTask$jscomp$0 = request.currentTask;
						request.currentTask = task;
						switchContext(task.context);
						var childrenLength = request$jscomp$0.children.length, chunkLength = request$jscomp$0.chunks.length, startNode$jscomp$0 = task.node;
						try {
							retryNode(request, task), request$jscomp$0.lastPushedText && request$jscomp$0.textEmbedded && request$jscomp$0.chunks.push(textSeparator), task.abortSet.delete(task), request$jscomp$0.status = 1, finishedSegment(request, task.blockedBoundary, request$jscomp$0), finishedTask(request, task.blockedBoundary, task.row, request$jscomp$0);
						} catch (thrownValue) {
							resetHooksState();
							request$jscomp$0.children.length = childrenLength;
							request$jscomp$0.chunks.length = chunkLength;
							var x$jscomp$0 = thrownValue === SuspenseException ? getSuspendedThenable() : thrownValue;
							if (request.aborted) thrownValue === SuspenseException && (task.thenableState = getThenableStateAfterSuspending()), request.currentTask = prevTask$jscomp$0, request$jscomp$0 = request, abortTask(task, request$jscomp$0), task.abortSet.delete(task), finishAbortedTask(task, request$jscomp$0, request$jscomp$0.fatalError);
							else {
								if ("object" === typeof x$jscomp$0 && null !== x$jscomp$0) {
									if ("function" === typeof x$jscomp$0.then) {
										request$jscomp$0.status = 0;
										task.thenableState = thrownValue === SuspenseException ? getThenableStateAfterSuspending() : null;
										var ping$jscomp$0 = task.ping;
										x$jscomp$0.then(ping$jscomp$0.resolve, ping$jscomp$0.reject);
										break a;
									}
									if ("Maximum call stack size exceeded" === x$jscomp$0.message && task.node !== startNode$jscomp$0) {
										request$jscomp$0.status = 0;
										task.thenableState = null;
										request.pingedTasks.push(task);
										break a;
									}
								}
								var errorInfo$jscomp$0 = getThrownInfo(task.componentStack);
								task.abortSet.delete(task);
								request$jscomp$0.status = 4;
								var boundary$jscomp$0 = task.blockedBoundary, row = task.row;
								null !== row && 0 === --row.pendingTasks && finishSuspenseListRow(request, row);
								request.allPendingTasks--;
								if (null === boundary$jscomp$0) if (isRecoverableError(x$jscomp$0)) {
									var fatalRecoverableError = cloneRecoverableErrorAsFatal(x$jscomp$0);
									logRecoverableError(request, fatalRecoverableError, errorInfo$jscomp$0);
									fatalError(request, fatalRecoverableError);
								} else logRecoverableError(request, x$jscomp$0, errorInfo$jscomp$0), fatalError(request, x$jscomp$0);
								else {
									var errorDigest$jscomp$0 = logRecoverableError(request, x$jscomp$0, errorInfo$jscomp$0);
									boundary$jscomp$0.pendingTasks--;
									if (4 !== boundary$jscomp$0.status) {
										boundary$jscomp$0.status = 4;
										boundary$jscomp$0.errorDigest = errorDigest$jscomp$0;
										untrackBoundary(request, boundary$jscomp$0);
										var boundaryRow = boundary$jscomp$0.row;
										null !== boundaryRow && (request.allPendingTasks++, 0 === --boundaryRow.pendingTasks && finishSuspenseListRow(request, boundaryRow), request.allPendingTasks--);
										boundary$jscomp$0.parentFlushed && request.clientRenderedBoundaries.push(boundary$jscomp$0);
										0 === request.pendingRootTasks && null === request.trackedPostpones && null !== boundary$jscomp$0.preamble && preparePreamble(request);
									}
									0 === request.allPendingTasks && completeAll(request);
								}
							}
						} finally {
							request.currentTask = prevTask$jscomp$0;
						}
					}
				}
				pingedTasks.splice(0, i);
				null !== request$jscomp$1.destination && flushCompletedQueues(request$jscomp$1, request$jscomp$1.destination);
			} catch (error) {
				logRecoverableError(request$jscomp$1, error, {}), fatalError(request$jscomp$1, error);
			} finally {
				currentResumableState = prevResumableState, ReactSharedInternals.H = prevDispatcher, ReactSharedInternals.A = prevAsyncDispatcher, prevDispatcher === HooksDispatcher && switchContext(prevContext), currentRequest = prevRequest;
			}
		}
	}
	function preparePreambleFromSubtree(request, segment, collectedPreambleSegments) {
		segment.preambleChildren.length && collectedPreambleSegments.push(segment.preambleChildren);
		for (var pendingPreambles = !1, i = 0; i < segment.children.length; i++) pendingPreambles = preparePreambleFromSegment(request, segment.children[i], collectedPreambleSegments) || pendingPreambles;
		return pendingPreambles;
	}
	function preparePreambleFromSegment(request, segment, collectedPreambleSegments) {
		var boundary = segment.boundary;
		if (null === boundary) return preparePreambleFromSubtree(request, segment, collectedPreambleSegments);
		var preamble = boundary.preamble;
		if (null === preamble) return !1;
		switch (boundary.status) {
			case 1:
				hoistPreambleState(request.renderState, preamble.content);
				request.byteSize += boundary.byteSize;
				segment = boundary.completedSegments[0];
				if (!segment) throw Error("A previously unvisited boundary must have exactly one root segment. This is a bug in React.");
				return preparePreambleFromSubtree(request, segment, collectedPreambleSegments);
			case 5: if (null !== request.trackedPostpones) return !0;
			case 4: if (1 === segment.status) return hoistPreambleState(request.renderState, preamble.fallback), preparePreambleFromSubtree(request, segment, collectedPreambleSegments);
			default: return !0;
		}
	}
	function preparePreamble(request) {
		if (request.completedRootSegment && null === request.completedPreambleSegments) {
			var collectedPreambleSegments = [], originalRequestByteSize = request.byteSize, hasPendingPreambles = preparePreambleFromSegment(request, request.completedRootSegment, collectedPreambleSegments), preamble = request.renderState.preamble;
			!1 === hasPendingPreambles || preamble.headChunks && preamble.bodyChunks ? request.completedPreambleSegments = collectedPreambleSegments : request.byteSize = originalRequestByteSize;
		}
	}
	function flushSubtree(request, destination, segment, hoistableState) {
		segment.parentFlushed = !0;
		switch (segment.status) {
			case 0: segment.id = request.nextSegmentId++;
			case 5: return hoistableState = segment.id, segment.lastPushedText = !1, segment.textEmbedded = !1, request = request.renderState, writeChunk(destination, placeholder1), writeChunk(destination, request.placeholderPrefix), request = hoistableState.toString(16), writeChunk(destination, request), writeChunkAndReturn(destination, placeholder2);
			case 1:
				segment.status = 2;
				var r = !0, chunks = segment.chunks, chunkIdx = 0;
				segment = segment.children;
				for (var childIdx = 0; childIdx < segment.length; childIdx++) {
					for (r = segment[childIdx]; chunkIdx < r.index; chunkIdx++) writeChunk(destination, chunks[chunkIdx]);
					r = flushSegment(request, destination, r, hoistableState);
				}
				for (; chunkIdx < chunks.length - 1; chunkIdx++) writeChunk(destination, chunks[chunkIdx]);
				chunkIdx < chunks.length && (r = writeChunkAndReturn(destination, chunks[chunkIdx]));
				return r;
			case 3: return !0;
			default: throw Error("Aborted, errored or already flushed boundaries should not be flushed again. This is a bug in React.");
		}
	}
	var flushedByteSize = 0;
	function flushSegment(request, destination, segment, hoistableState) {
		var boundary = segment.boundary;
		if (null === boundary) return flushSubtree(request, destination, segment, hoistableState);
		segment.boundary = null;
		boundary.parentFlushed = !0;
		if (4 === boundary.status) {
			var row = boundary.row;
			null !== row && 0 === --row.pendingTasks && finishSuspenseListRow(request, row);
			boundary = boundary.errorDigest;
			writeChunkAndReturn(destination, startClientRenderedSuspenseBoundary);
			writeChunk(destination, clientRenderedSuspenseBoundaryError1);
			null != boundary && (writeChunk(destination, clientRenderedSuspenseBoundaryError1A), writeChunk(destination, escapeTextForBrowser(boundary)), writeChunk(destination, clientRenderedSuspenseBoundaryErrorAttrInterstitial));
			writeChunkAndReturn(destination, clientRenderedSuspenseBoundaryError2);
			flushSubtree(request, destination, segment, hoistableState);
		} else if (1 !== boundary.status) 0 === boundary.status && (boundary.rootSegmentID = request.nextSegmentId++), 0 < boundary.completedSegments.length && request.partialBoundaries.push(boundary), writeStartPendingSuspenseBoundary(destination, request.renderState, boundary.rootSegmentID), hoistableState && hoistHoistables(hoistableState, boundary.fallbackState), flushSubtree(request, destination, segment, hoistableState);
		else if (!flushingPartialBoundaries && isEligibleForOutlining(request, boundary) && (flushedByteSize + boundary.byteSize > request.progressiveChunkSize || hasSuspenseyContent(boundary.contentState, flushingShell) || boundary.defer)) boundary.rootSegmentID = request.nextSegmentId++, request.completedBoundaries.push(boundary), writeStartPendingSuspenseBoundary(destination, request.renderState, boundary.rootSegmentID), flushSubtree(request, destination, segment, hoistableState);
		else {
			flushedByteSize += boundary.byteSize;
			hoistableState && hoistHoistables(hoistableState, boundary.contentState);
			segment = boundary.row;
			null !== segment && isEligibleForOutlining(request, boundary) && 0 === --segment.pendingTasks && finishSuspenseListRow(request, segment);
			writeChunkAndReturn(destination, startCompletedSuspenseBoundary);
			segment = boundary.completedSegments;
			if (1 !== segment.length) throw Error("A previously unvisited boundary must have exactly one root segment. This is a bug in React.");
			flushSegment(request, destination, segment[0], hoistableState);
		}
		return writeChunkAndReturn(destination, endSuspenseBoundary);
	}
	function flushSegmentContainer(request, destination, segment, hoistableState) {
		writeStartSegment(destination, request.renderState, segment.parentFormatContext, segment.id);
		flushSegment(request, destination, segment, hoistableState);
		return writeEndSegment(destination, segment.parentFormatContext);
	}
	function flushCompletedBoundary(request, destination, boundary) {
		flushedByteSize = boundary.byteSize;
		for (var completedSegments = boundary.completedSegments, i = 0; i < completedSegments.length; i++) flushPartiallyCompletedSegment(request, destination, boundary, completedSegments[i]);
		completedSegments.length = 0;
		completedSegments = boundary.row;
		null !== completedSegments && isEligibleForOutlining(request, boundary) && 0 === --completedSegments.pendingTasks && finishSuspenseListRow(request, completedSegments);
		writeHoistablesForBoundary(destination, boundary.contentState, request.renderState);
		completedSegments = request.resumableState;
		request = request.renderState;
		i = boundary.rootSegmentID;
		boundary = boundary.contentState;
		var requiresStyleInsertion = request.stylesToHoist, requiresViewTransitions = 0 !== (completedSegments.instructions & 128);
		request.stylesToHoist = !1;
		writeChunk(destination, request.startInlineScript);
		writeChunk(destination, endOfStartTag);
		requiresStyleInsertion ? (0 === (completedSegments.instructions & 4) && (completedSegments.instructions |= 4, writeChunk(destination, clientRenderScriptFunctionOnly)), 0 === (completedSegments.instructions & 2) && (completedSegments.instructions |= 2, writeChunk(destination, completeBoundaryScriptFunctionOnly)), requiresViewTransitions && 0 === (completedSegments.instructions & 256) && (completedSegments.instructions |= 256, writeChunk(destination, "$RV=function(B,g){function h(a,c){var e=a.getAttribute(c);e&&(c=a.style,l.push(a,c.viewTransitionName,c.viewTransitionClass),\"auto\"!==e&&(c.viewTransitionClass=e),(a=a.getAttribute(\"vt-name\"))||(a=\"_T_\"+N++ +\"_\"),a=CSS.escape(a)!==a?\"r-\"+btoa(a).replace(/=/g,\"\"):a,c.viewTransitionName=a,C=!0)}var C=!1,N=0,l=[];try{var f=document.__reactViewTransition;if(f){f.finished.finally($RV.bind(null,g));return}var m=new Map;for(f=1;f<g.length;f+=2)for(var k=g[f].querySelectorAll(\"[vt-share]\"),d=0;d<k.length;d++){var b=k[d];m.set(b.getAttribute(\"vt-name\"),b)}var u=[];for(k=0;k<g.length;k+=2){var D=g[k],x=D.parentNode;if(x){var v=x.getBoundingClientRect();if(v.left||v.top||v.width||v.height){b=D;for(f=0;b;){if(8===b.nodeType){var t=b.data;if(\"/$\"===t)if(0===f)break;else f--;else\"$\"!==t&&\"$?\"!==t&&\"$~\"!==t&&\"$!\"!==t||f++}else if(1===b.nodeType){d=b;var E=d.getAttribute(\"vt-name\"),y=m.get(E);h(d,y?\"vt-share\":\"vt-exit\");y&&(h(y,\"vt-share\"),m.set(E,null));for(var F=d.querySelectorAll(\"[vt-share]\"),\nz=0;z<F.length;z++){var G=F[z],H=G.getAttribute(\"vt-name\"),I=m.get(H);I&&(h(G,\"vt-share\"),h(I,\"vt-share\"),m.set(H,null))}var J=d.querySelectorAll(\"[vt-parent-exit]\");for(d=0;d<J.length;d++)h(J[d],\"vt-parent-exit\")}b=b.nextSibling}for(var K=g[k+1],n=K.firstElementChild;n;){null!==m.get(n.getAttribute(\"vt-name\"))&&h(n,\"vt-enter\");var L=n.querySelectorAll(\"[vt-parent-enter]\");for(b=0;b<L.length;b++)h(L[b],\"vt-parent-enter\");n=n.nextElementSibling}b=x;do for(var p=b.firstElementChild;p;){var M=p.getAttribute(\"vt-update\");\nM&&\"none\"!==M&&!l.includes(p)&&h(p,\"vt-update\");p=p.nextElementSibling}while((b=b.parentNode)&&1===b.nodeType&&\"none\"!==b.getAttribute(\"vt-update\"));u.push.apply(u,K.querySelectorAll('img[src]:not([loading=\"lazy\"])'))}}}if(C){var A=document.__reactViewTransition=document.startViewTransition({update:function(){B(g);for(var a=[document.documentElement.clientHeight,document.fonts.ready],c={},e=0;e<u.length;c={g:c.g},e++)if(c.g=u[e],!c.g.complete){var q=c.g.getBoundingClientRect();0<q.bottom&&0<q.right&&\nq.top<window.innerHeight&&q.left<window.innerWidth&&(q=new Promise(function(w){return function(r){w.g.addEventListener(\"load\",r);w.g.addEventListener(\"error\",r)}}(c)),a.push(q))}return Promise.race([Promise.all(a),new Promise(function(w){var r=performance.now();setTimeout(w,2300>r&&2E3<r?2300-r:500)})])},types:[]});A.ready.finally(function(){for(var a=l.length-3;0<=a;a-=3){var c=l[a],e=c.style;e.viewTransitionName=l[a+1];e.viewTransitionClass=l[a+1];\"\"===c.getAttribute(\"style\")&&c.removeAttribute(\"style\")}});\nA.finished.finally(function(){document.__reactViewTransition===A&&(document.__reactViewTransition=null)});$RB=[];return}}catch(a){}B(g)}.bind(null,$RV);")), 0 === (completedSegments.instructions & 8) ? (completedSegments.instructions |= 8, writeChunk(destination, completeBoundaryWithStylesScript1FullPartial)) : writeChunk(destination, completeBoundaryWithStylesScript1Partial)) : (0 === (completedSegments.instructions & 2) && (completedSegments.instructions |= 2, writeChunk(destination, completeBoundaryScriptFunctionOnly)), requiresViewTransitions && 0 === (completedSegments.instructions & 256) && (completedSegments.instructions |= 256, writeChunk(destination, "$RV=function(B,g){function h(a,c){var e=a.getAttribute(c);e&&(c=a.style,l.push(a,c.viewTransitionName,c.viewTransitionClass),\"auto\"!==e&&(c.viewTransitionClass=e),(a=a.getAttribute(\"vt-name\"))||(a=\"_T_\"+N++ +\"_\"),a=CSS.escape(a)!==a?\"r-\"+btoa(a).replace(/=/g,\"\"):a,c.viewTransitionName=a,C=!0)}var C=!1,N=0,l=[];try{var f=document.__reactViewTransition;if(f){f.finished.finally($RV.bind(null,g));return}var m=new Map;for(f=1;f<g.length;f+=2)for(var k=g[f].querySelectorAll(\"[vt-share]\"),d=0;d<k.length;d++){var b=k[d];m.set(b.getAttribute(\"vt-name\"),b)}var u=[];for(k=0;k<g.length;k+=2){var D=g[k],x=D.parentNode;if(x){var v=x.getBoundingClientRect();if(v.left||v.top||v.width||v.height){b=D;for(f=0;b;){if(8===b.nodeType){var t=b.data;if(\"/$\"===t)if(0===f)break;else f--;else\"$\"!==t&&\"$?\"!==t&&\"$~\"!==t&&\"$!\"!==t||f++}else if(1===b.nodeType){d=b;var E=d.getAttribute(\"vt-name\"),y=m.get(E);h(d,y?\"vt-share\":\"vt-exit\");y&&(h(y,\"vt-share\"),m.set(E,null));for(var F=d.querySelectorAll(\"[vt-share]\"),\nz=0;z<F.length;z++){var G=F[z],H=G.getAttribute(\"vt-name\"),I=m.get(H);I&&(h(G,\"vt-share\"),h(I,\"vt-share\"),m.set(H,null))}var J=d.querySelectorAll(\"[vt-parent-exit]\");for(d=0;d<J.length;d++)h(J[d],\"vt-parent-exit\")}b=b.nextSibling}for(var K=g[k+1],n=K.firstElementChild;n;){null!==m.get(n.getAttribute(\"vt-name\"))&&h(n,\"vt-enter\");var L=n.querySelectorAll(\"[vt-parent-enter]\");for(b=0;b<L.length;b++)h(L[b],\"vt-parent-enter\");n=n.nextElementSibling}b=x;do for(var p=b.firstElementChild;p;){var M=p.getAttribute(\"vt-update\");\nM&&\"none\"!==M&&!l.includes(p)&&h(p,\"vt-update\");p=p.nextElementSibling}while((b=b.parentNode)&&1===b.nodeType&&\"none\"!==b.getAttribute(\"vt-update\"));u.push.apply(u,K.querySelectorAll('img[src]:not([loading=\"lazy\"])'))}}}if(C){var A=document.__reactViewTransition=document.startViewTransition({update:function(){B(g);for(var a=[document.documentElement.clientHeight,document.fonts.ready],c={},e=0;e<u.length;c={g:c.g},e++)if(c.g=u[e],!c.g.complete){var q=c.g.getBoundingClientRect();0<q.bottom&&0<q.right&&\nq.top<window.innerHeight&&q.left<window.innerWidth&&(q=new Promise(function(w){return function(r){w.g.addEventListener(\"load\",r);w.g.addEventListener(\"error\",r)}}(c)),a.push(q))}return Promise.race([Promise.all(a),new Promise(function(w){var r=performance.now();setTimeout(w,2300>r&&2E3<r?2300-r:500)})])},types:[]});A.ready.finally(function(){for(var a=l.length-3;0<=a;a-=3){var c=l[a],e=c.style;e.viewTransitionName=l[a+1];e.viewTransitionClass=l[a+1];\"\"===c.getAttribute(\"style\")&&c.removeAttribute(\"style\")}});\nA.finished.finally(function(){document.__reactViewTransition===A&&(document.__reactViewTransition=null)});$RB=[];return}}catch(a){}B(g)}.bind(null,$RV);")), writeChunk(destination, completeBoundaryScript1Partial));
		completedSegments = i.toString(16);
		writeChunk(destination, request.boundaryPrefix);
		writeChunk(destination, completedSegments);
		writeChunk(destination, completeBoundaryScript2);
		writeChunk(destination, request.segmentPrefix);
		writeChunk(destination, completedSegments);
		requiresStyleInsertion ? (writeChunk(destination, completeBoundaryScript3a), writeStyleResourceDependenciesInJS(destination, boundary)) : writeChunk(destination, completeBoundaryScript3b);
		boundary = writeChunkAndReturn(destination, completeBoundaryScriptEnd);
		return writeBootstrap(destination, request) && boundary;
	}
	function flushPartiallyCompletedSegment(request, destination, boundary, segment) {
		if (2 === segment.status) return !0;
		var hoistableState = boundary.contentState, segmentID = segment.id;
		if (-1 === segmentID) {
			if (-1 === (segment.id = boundary.rootSegmentID)) throw Error("A root segment ID must have been assigned by now. This is a bug in React.");
			return flushSegmentContainer(request, destination, segment, hoistableState);
		}
		if (segmentID === boundary.rootSegmentID) return flushSegmentContainer(request, destination, segment, hoistableState);
		flushSegmentContainer(request, destination, segment, hoistableState);
		boundary = request.resumableState;
		request = request.renderState;
		writeChunk(destination, request.startInlineScript);
		writeChunk(destination, endOfStartTag);
		0 === (boundary.instructions & 1) ? (boundary.instructions |= 1, writeChunk(destination, completeSegmentScript1Full)) : writeChunk(destination, completeSegmentScript1Partial);
		writeChunk(destination, request.segmentPrefix);
		segmentID = segmentID.toString(16);
		writeChunk(destination, segmentID);
		writeChunk(destination, completeSegmentScript2);
		writeChunk(destination, request.placeholderPrefix);
		writeChunk(destination, segmentID);
		destination = writeChunkAndReturn(destination, completeSegmentScriptEnd);
		return destination;
	}
	var flushingPartialBoundaries = !1;
	var flushingShell = !1;
	function flushCompletedQueues(request, destination) {
		currentView = /* @__PURE__ */ new Uint8Array(4096);
		writtenBytes = 0;
		destinationHasCapacity$1 = !0;
		try {
			if (!(0 < request.pendingRootTasks)) {
				var i, completedRootSegment = request.completedRootSegment;
				if (null !== completedRootSegment) {
					if (5 === completedRootSegment.status) return;
					var completedPreambleSegments = request.completedPreambleSegments;
					if (null === completedPreambleSegments) return;
					flushedByteSize = request.byteSize;
					var resumableState = request.resumableState, renderState = request.renderState, preamble = renderState.preamble, htmlChunks = preamble.htmlChunks, headChunks = preamble.headChunks, i$jscomp$0;
					if (htmlChunks) {
						for (i$jscomp$0 = 0; i$jscomp$0 < htmlChunks.length; i$jscomp$0++) writeChunk(destination, htmlChunks[i$jscomp$0]);
						if (headChunks) for (i$jscomp$0 = 0; i$jscomp$0 < headChunks.length; i$jscomp$0++) writeChunk(destination, headChunks[i$jscomp$0]);
						else writeChunk(destination, startChunkForTag("head")), writeChunk(destination, endOfStartTag);
					} else if (headChunks) for (i$jscomp$0 = 0; i$jscomp$0 < headChunks.length; i$jscomp$0++) writeChunk(destination, headChunks[i$jscomp$0]);
					var charsetChunks = renderState.charsetChunks;
					for (i$jscomp$0 = 0; i$jscomp$0 < charsetChunks.length; i$jscomp$0++) writeChunk(destination, charsetChunks[i$jscomp$0]);
					charsetChunks.length = 0;
					renderState.preconnects.forEach(flushResource, destination);
					renderState.preconnects.clear();
					var viewportChunks = renderState.viewportChunks;
					for (i$jscomp$0 = 0; i$jscomp$0 < viewportChunks.length; i$jscomp$0++) writeChunk(destination, viewportChunks[i$jscomp$0]);
					viewportChunks.length = 0;
					renderState.fontPreloads.forEach(flushResource, destination);
					renderState.fontPreloads.clear();
					renderState.highImagePreloads.forEach(flushResource, destination);
					renderState.highImagePreloads.clear();
					currentlyFlushingRenderState = renderState;
					renderState.styles.forEach(flushStylesInPreamble, destination);
					currentlyFlushingRenderState = null;
					var importMapChunks = renderState.importMapChunks;
					for (i$jscomp$0 = 0; i$jscomp$0 < importMapChunks.length; i$jscomp$0++) writeChunk(destination, importMapChunks[i$jscomp$0]);
					importMapChunks.length = 0;
					renderState.bootstrapScripts.forEach(flushResource, destination);
					renderState.scripts.forEach(flushResource, destination);
					renderState.scripts.clear();
					renderState.bulkPreloads.forEach(flushResource, destination);
					renderState.bulkPreloads.clear();
					htmlChunks || headChunks || (resumableState.instructions |= 32);
					var hoistableChunks = renderState.hoistableChunks;
					for (i$jscomp$0 = 0; i$jscomp$0 < hoistableChunks.length; i$jscomp$0++) writeChunk(destination, hoistableChunks[i$jscomp$0]);
					for (resumableState = hoistableChunks.length = 0; resumableState < completedPreambleSegments.length; resumableState++) {
						var segments = completedPreambleSegments[resumableState];
						for (renderState = 0; renderState < segments.length; renderState++) flushSegment(request, destination, segments[renderState], null);
					}
					var preamble$jscomp$0 = request.renderState.preamble, headChunks$jscomp$0 = preamble$jscomp$0.headChunks;
					(preamble$jscomp$0.htmlChunks || headChunks$jscomp$0) && writeChunk(destination, endChunkForTag("head"));
					var bodyChunks = preamble$jscomp$0.bodyChunks;
					if (bodyChunks) for (completedPreambleSegments = 0; completedPreambleSegments < bodyChunks.length; completedPreambleSegments++) writeChunk(destination, bodyChunks[completedPreambleSegments]);
					flushingShell = !0;
					flushSegment(request, destination, completedRootSegment, null);
					flushingShell = !1;
					request.completedRootSegment = null;
					var renderState$jscomp$0 = request.renderState;
					if (0 !== request.allPendingTasks || 0 !== request.clientRenderedBoundaries.length || 0 !== request.completedBoundaries.length || null !== request.trackedPostpones && (0 !== request.trackedPostpones.rootNodes.length || null !== request.trackedPostpones.rootSlots)) {
						var resumableState$jscomp$0 = request.resumableState;
						if (0 === (resumableState$jscomp$0.instructions & 64)) {
							resumableState$jscomp$0.instructions |= 64;
							writeChunk(destination, renderState$jscomp$0.startInlineScript);
							if (0 === (resumableState$jscomp$0.instructions & 32)) {
								resumableState$jscomp$0.instructions |= 32;
								var shellId = "_" + resumableState$jscomp$0.idPrefix + "R_";
								writeChunk(destination, completedShellIdAttributeStart);
								writeChunk(destination, escapeTextForBrowser(shellId));
								writeChunk(destination, attributeEnd);
							}
							writeChunk(destination, endOfStartTag);
							writeChunk(destination, shellTimeRuntimeScript);
							writeChunkAndReturn(destination, endInlineScript);
						}
					}
					writeBootstrap(destination, renderState$jscomp$0);
				}
				var renderState$jscomp$1 = request.renderState;
				completedRootSegment = 0;
				var viewportChunks$jscomp$0 = renderState$jscomp$1.viewportChunks;
				for (completedRootSegment = 0; completedRootSegment < viewportChunks$jscomp$0.length; completedRootSegment++) writeChunk(destination, viewportChunks$jscomp$0[completedRootSegment]);
				viewportChunks$jscomp$0.length = 0;
				renderState$jscomp$1.preconnects.forEach(flushResource, destination);
				renderState$jscomp$1.preconnects.clear();
				renderState$jscomp$1.fontPreloads.forEach(flushResource, destination);
				renderState$jscomp$1.fontPreloads.clear();
				renderState$jscomp$1.highImagePreloads.forEach(flushResource, destination);
				renderState$jscomp$1.highImagePreloads.clear();
				renderState$jscomp$1.styles.forEach(preloadLateStyles, destination);
				renderState$jscomp$1.scripts.forEach(flushResource, destination);
				renderState$jscomp$1.scripts.clear();
				renderState$jscomp$1.bulkPreloads.forEach(flushResource, destination);
				renderState$jscomp$1.bulkPreloads.clear();
				var hoistableChunks$jscomp$0 = renderState$jscomp$1.hoistableChunks;
				for (completedRootSegment = 0; completedRootSegment < hoistableChunks$jscomp$0.length; completedRootSegment++) writeChunk(destination, hoistableChunks$jscomp$0[completedRootSegment]);
				hoistableChunks$jscomp$0.length = 0;
				var clientRenderedBoundaries = request.clientRenderedBoundaries;
				for (i = 0; i < clientRenderedBoundaries.length; i++) {
					var boundary = clientRenderedBoundaries[i];
					renderState$jscomp$1 = destination;
					var resumableState$jscomp$1 = request.resumableState, renderState$jscomp$2 = request.renderState, id = boundary.rootSegmentID, errorDigest = boundary.errorDigest;
					writeChunk(renderState$jscomp$1, renderState$jscomp$2.startInlineScript);
					writeChunk(renderState$jscomp$1, endOfStartTag);
					0 === (resumableState$jscomp$1.instructions & 4) ? (resumableState$jscomp$1.instructions |= 4, writeChunk(renderState$jscomp$1, clientRenderScript1Full)) : writeChunk(renderState$jscomp$1, clientRenderScript1Partial);
					writeChunk(renderState$jscomp$1, renderState$jscomp$2.boundaryPrefix);
					writeChunk(renderState$jscomp$1, id.toString(16));
					writeChunk(renderState$jscomp$1, clientRenderScript1A);
					null != errorDigest && (writeChunk(renderState$jscomp$1, clientRenderErrorScriptArgInterstitial), null == errorDigest ? writeChunk(renderState$jscomp$1, clientRenderErrorScriptNull) : writeChunk(renderState$jscomp$1, escapeJSStringsForInstructionScripts(errorDigest)));
					var JSCompiler_inline_result = writeChunkAndReturn(renderState$jscomp$1, clientRenderScriptEnd);
					if (!JSCompiler_inline_result) {
						request.destination = null;
						i++;
						clientRenderedBoundaries.splice(0, i);
						return;
					}
				}
				clientRenderedBoundaries.splice(0, i);
				var completedBoundaries = request.completedBoundaries;
				for (i = 0; i < completedBoundaries.length; i++) if (!flushCompletedBoundary(request, destination, completedBoundaries[i])) {
					request.destination = null;
					i++;
					completedBoundaries.splice(0, i);
					return;
				}
				completedBoundaries.splice(0, i);
				completeWriting(destination);
				currentView = /* @__PURE__ */ new Uint8Array(4096);
				writtenBytes = 0;
				flushingPartialBoundaries = destinationHasCapacity$1 = !0;
				var partialBoundaries = request.partialBoundaries;
				for (i = 0; i < partialBoundaries.length; i++) {
					var boundary$71 = partialBoundaries[i];
					a: {
						clientRenderedBoundaries = request;
						boundary = destination;
						flushedByteSize = boundary$71.byteSize;
						var completedSegments = boundary$71.completedSegments;
						for (JSCompiler_inline_result = 0; JSCompiler_inline_result < completedSegments.length; JSCompiler_inline_result++) if (!flushPartiallyCompletedSegment(clientRenderedBoundaries, boundary, boundary$71, completedSegments[JSCompiler_inline_result])) {
							JSCompiler_inline_result++;
							completedSegments.splice(0, JSCompiler_inline_result);
							var JSCompiler_inline_result$jscomp$0 = !1;
							break a;
						}
						completedSegments.splice(0, JSCompiler_inline_result);
						var row = boundary$71.row;
						null !== row && row.together && 1 === boundary$71.pendingTasks && (1 === row.pendingTasks ? unblockSuspenseListRow(clientRenderedBoundaries, row, row.hoistables) : row.pendingTasks--);
						JSCompiler_inline_result$jscomp$0 = writeHoistablesForBoundary(boundary, boundary$71.contentState, clientRenderedBoundaries.renderState);
					}
					if (!JSCompiler_inline_result$jscomp$0) {
						request.destination = null;
						i++;
						partialBoundaries.splice(0, i);
						return;
					}
				}
				partialBoundaries.splice(0, i);
				flushingPartialBoundaries = !1;
				var largeBoundaries = request.completedBoundaries;
				for (i = 0; i < largeBoundaries.length; i++) if (!flushCompletedBoundary(request, destination, largeBoundaries[i])) {
					request.destination = null;
					i++;
					largeBoundaries.splice(0, i);
					return;
				}
				largeBoundaries.splice(0, i);
			}
		} finally {
			flushingPartialBoundaries = !1, i = request.postponedState, null !== i && (i.nextSegmentId = request.nextSegmentId), 0 === request.allPendingTasks && 0 === request.clientRenderedBoundaries.length && 0 === request.completedBoundaries.length ? (request.flushScheduled = !1, i = request.resumableState, i.hasBody && writeChunk(destination, endChunkForTag("body")), i.hasHtml && writeChunk(destination, endChunkForTag("html")), completeWriting(destination), flushBuffered(destination), endRenderLifetime(request), request.status = 13, destination.end(), request.destination = null) : (completeWriting(destination), flushBuffered(destination));
		}
	}
	function startWork(request) {
		request.flushScheduled = null !== request.destination;
		scheduleMicrotask(function() {
			return requestStorage.run(request, performWork, request);
		});
		setImmediate(function() {
			10 === request.status && (request.status = 11);
			null === request.trackedPostpones && requestStorage.run(request, enqueueEarlyPreloadsAfterInitialWork, request);
		});
	}
	function enqueueEarlyPreloadsAfterInitialWork(request) {
		safelyEmitEarlyPreloads(request, 0 === request.pendingRootTasks);
	}
	function enqueueFlush(request) {
		!1 === request.flushScheduled && 0 === request.pingedTasks.length && null !== request.destination && (request.flushScheduled = !0, setImmediate(function() {
			var destination = request.destination;
			destination ? flushCompletedQueues(request, destination) : request.flushScheduled = !1;
		}));
	}
	function startFlowing(request, destination) {
		if (12 === request.status) request.status = 13, request = request.fatalError, isRecoverableError(request) && (request = cloneRecoverableErrorAsFatal(request)), destination.destroy(request);
		else if (13 !== request.status && null === request.destination) {
			request.destination = destination;
			try {
				flushCompletedQueues(request, destination);
			} catch (error$73) {
				logRecoverableError(request, error$73, {}), fatalError(request, error$73);
			}
		}
	}
	function finishAbort(request, abortableTasks) {
		try {
			if (0 < abortableTasks.size) {
				var error = request.fatalError;
				abortableTasks.forEach(function(task) {
					return finishAbortedTask(task, request, error);
				});
				abortableTasks.clear();
			}
			null !== request.destination && flushCompletedQueues(request, request.destination);
		} catch (error$74) {
			logRecoverableError(request, error$74, {}), fatalError(request, error$74);
		}
	}
	function endRenderLifetime(request) {
		request = request.renderLifetimeController;
		null !== request && request.abort("The render ended.");
	}
	function attachAbortSignal(request, signal) {
		if (signal.aborted) abort(request, signal.reason);
		else {
			var renderLifetimeController = new AbortController();
			request.renderLifetimeController = renderLifetimeController;
			signal.addEventListener("abort", function() {
				abort(request, signal.reason);
			}, { signal: renderLifetimeController.signal });
		}
	}
	function abort(request, reason) {
		if (!(request.aborted || 11 !== request.status && 10 !== request.status)) {
			endRenderLifetime(request);
			var isRecoverableReason = "object" === typeof reason && null !== reason && reason.$$typeof === REACT_RECOVERABLE_TYPE;
			request.aborted = !0;
			reason = isRecoverableReason ? createRecoverableError(reason) : void 0 === reason ? Error("The render was aborted by the server without a reason.") : "object" === typeof reason && null !== reason && "function" === typeof reason.then ? Error("The render was aborted by the server with a promise.") : reason;
			request.fatalError = reason;
			var abortableTasks = request.abortableTasks;
			abortableTasks.forEach(function(task) {
				return abortTask(task, request);
			});
			setImmediate(function() {
				return finishAbort(request, abortableTasks);
			});
		}
	}
	function addToReplayParent(node, parentKeyPath, trackedPostpones) {
		if (null === parentKeyPath) trackedPostpones.rootNodes.push(node);
		else {
			var workingMap = trackedPostpones.workingMap, parentNode = workingMap.get(parentKeyPath);
			void 0 === parentNode && (parentNode = [
				parentKeyPath[1],
				parentKeyPath[2],
				[],
				null
			], workingMap.set(parentKeyPath, parentNode), addToReplayParent(parentNode, parentKeyPath[0], trackedPostpones));
			parentNode[2].push(node);
		}
	}
	function getPostponedState(request) {
		var trackedPostpones = request.trackedPostpones;
		if (null === trackedPostpones || 0 === trackedPostpones.rootNodes.length && null === trackedPostpones.rootSlots) return request.trackedPostpones = null;
		var hasFlushableShell = null === request.completedRootSegment || 5 !== request.completedRootSegment.status && null !== request.completedPreambleSegments;
		if (hasFlushableShell) {
			var nextSegmentId = request.nextSegmentId;
			var replaySlots = trackedPostpones.rootSlots;
			var resumableState = request.resumableState;
			resumableState.bootstrapScriptContent = void 0;
			resumableState.bootstrapScripts = void 0;
			resumableState.bootstrapModules = void 0;
		} else {
			nextSegmentId = 0;
			replaySlots = -1;
			resumableState = request.resumableState;
			var renderState = request.renderState;
			resumableState.nextFormID = 0;
			resumableState.hasBody = !1;
			resumableState.hasHtml = !1;
			resumableState.unknownResources = { font: renderState.resets.font };
			resumableState.dnsResources = renderState.resets.dns;
			resumableState.connectResources = renderState.resets.connect;
			resumableState.imageResources = renderState.resets.image;
			resumableState.styleResources = renderState.resets.style;
			resumableState.scriptResources = {};
			resumableState.moduleUnknownResources = {};
			resumableState.moduleScriptResources = {};
			resumableState.instructions = 0;
		}
		trackedPostpones = {
			nextSegmentId,
			rootFormatContext: request.rootFormatContext,
			progressiveChunkSize: request.progressiveChunkSize,
			resumableState: request.resumableState,
			replayNodes: trackedPostpones.rootNodes,
			replaySlots
		};
		hasFlushableShell && (request.postponedState = trackedPostpones);
		return trackedPostpones;
	}
	function ensureCorrectIsomorphicReactVersion() {
		var isomorphicReactPackageVersion = React.version;
		if ("19.3.0" !== isomorphicReactPackageVersion) throw Error("Incompatible React versions: The \"react\" and \"react-dom\" packages must have the exact same version. Instead got:\n  - react:      " + (isomorphicReactPackageVersion + "\n  - react-dom:  19.3.0\nLearn more: https://react.dev/warnings/version-mismatch"));
	}
	ensureCorrectIsomorphicReactVersion();
	function createDrainHandler(destination, request) {
		return function() {
			return startFlowing(request, destination);
		};
	}
	function createCancelHandler(request, reason) {
		return function() {
			request.destination = null;
			abort(request, Error(reason));
		};
	}
	function createRequestImpl(children, options) {
		var resumableState = createResumableState(options ? options.identifierPrefix : void 0, options ? options.unstable_externalRuntimeSrc : void 0, options ? options.bootstrapScriptContent : void 0, options ? options.bootstrapScripts : void 0, options ? options.bootstrapModules : void 0);
		return createRequest(children, resumableState, createRenderState(resumableState, options ? options.nonce : void 0, options ? options.unstable_externalRuntimeSrc : void 0, options ? options.importMap : void 0, options ? options.onHeaders : void 0, options ? options.maxHeadersLength : void 0), createRootFormatContext(options ? options.namespaceURI : void 0), options ? options.progressiveChunkSize : void 0, options ? options.onError : void 0, options ? options.onBrowserBailout : void 0, options ? options.onAllReady : void 0, options ? options.onShellReady : void 0, options ? options.onShellError : void 0, void 0, options ? options.formState : void 0);
	}
	function createFakeWritableFromReadableStreamController$1(controller) {
		return {
			write: function(chunk) {
				"string" === typeof chunk && (chunk = textEncoder.encode(chunk));
				controller.enqueue(chunk);
				return !0;
			},
			end: function() {
				controller.close();
			},
			destroy: function(error) {
				"function" === typeof controller.error ? controller.error(error) : controller.close();
			}
		};
	}
	function resumeRequestImpl(children, postponedState, options) {
		return resumeRequest(children, postponedState, createRenderState(postponedState.resumableState, options ? options.nonce : void 0, void 0, void 0, void 0, void 0), options ? options.onError : void 0, options ? options.onBrowserBailout : void 0, options ? options.onAllReady : void 0, options ? options.onShellReady : void 0, options ? options.onShellError : void 0, void 0);
	}
	ensureCorrectIsomorphicReactVersion();
	function createFakeWritableFromReadableStreamController(controller) {
		return {
			write: function(chunk) {
				"string" === typeof chunk && (chunk = textEncoder.encode(chunk));
				controller.enqueue(chunk);
				return !0;
			},
			end: function() {
				controller.close();
			},
			destroy: function(error) {
				"function" === typeof controller.error ? controller.error(error) : controller.close();
			}
		};
	}
	function createFakeWritableFromReadable(readable) {
		return {
			write: function(chunk) {
				return readable.push(chunk);
			},
			end: function() {
				readable.push(null);
			},
			destroy: function(error) {
				readable.destroy(error);
			}
		};
	}
	exports.prerender = function(children, options) {
		return new Promise(function(resolve, reject) {
			var onHeaders = options ? options.onHeaders : void 0, onHeadersImpl;
			onHeaders && (onHeadersImpl = function(headersDescriptor) {
				onHeaders(new Headers(headersDescriptor));
			});
			var resources = createResumableState(options ? options.identifierPrefix : void 0, options ? options.unstable_externalRuntimeSrc : void 0, options ? options.bootstrapScriptContent : void 0, options ? options.bootstrapScripts : void 0, options ? options.bootstrapModules : void 0), request = createPrerenderRequest(children, resources, createRenderState(resources, void 0, options ? options.unstable_externalRuntimeSrc : void 0, options ? options.importMap : void 0, onHeadersImpl, options ? options.maxHeadersLength : void 0), createRootFormatContext(options ? options.namespaceURI : void 0), options ? options.progressiveChunkSize : void 0, options ? options.onError : void 0, options ? options.onBrowserBailout : void 0, function() {
				var writable, stream = new ReadableStream({
					type: "bytes",
					start: function(controller) {
						writable = createFakeWritableFromReadableStreamController(controller);
					},
					pull: function() {
						startFlowing(request, writable);
					},
					cancel: function(reason) {
						request.destination = null;
						abort(request, reason);
					}
				}, { highWaterMark: 0 });
				stream = {
					postponed: getPostponedState(request),
					prelude: stream
				};
				resolve(stream);
			}, void 0, void 0, reject);
			options && options.signal && attachAbortSignal(request, options.signal);
			startWork(request);
		});
	};
	exports.prerenderToNodeStream = function(children, options) {
		return new Promise(function(resolve, reject) {
			var resumableState = createResumableState(options ? options.identifierPrefix : void 0, options ? options.unstable_externalRuntimeSrc : void 0, options ? options.bootstrapScriptContent : void 0, options ? options.bootstrapScripts : void 0, options ? options.bootstrapModules : void 0), request = createPrerenderRequest(children, resumableState, createRenderState(resumableState, void 0, options ? options.unstable_externalRuntimeSrc : void 0, options ? options.importMap : void 0, options ? options.onHeaders : void 0, options ? options.maxHeadersLength : void 0), createRootFormatContext(options ? options.namespaceURI : void 0), options ? options.progressiveChunkSize : void 0, options ? options.onError : void 0, options ? options.onBrowserBailout : void 0, function() {
				var readable = new stream.Readable({ read: function() {
					startFlowing(request, writable);
				} }), writable = createFakeWritableFromReadable(readable);
				readable = {
					postponed: getPostponedState(request),
					prelude: readable
				};
				resolve(readable);
			}, void 0, void 0, reject);
			options && options.signal && attachAbortSignal(request, options.signal);
			startWork(request);
		});
	};
	exports.renderToPipeableStream = function(children, options) {
		var request = createRequestImpl(children, options), hasStartedFlowing = !1;
		startWork(request);
		return {
			pipe: function(destination) {
				if (hasStartedFlowing) throw Error("React currently only supports piping to one writable stream.");
				hasStartedFlowing = !0;
				safelyEmitEarlyPreloads(request, null === request.trackedPostpones ? 0 === request.pendingRootTasks : null === request.completedRootSegment ? 0 === request.pendingRootTasks : 5 !== request.completedRootSegment.status);
				startFlowing(request, destination);
				destination.on("drain", createDrainHandler(destination, request));
				destination.on("error", createCancelHandler(request, "The destination stream errored while writing data."));
				destination.on("close", createCancelHandler(request, "The destination stream closed early."));
				return destination;
			},
			abort: function(reason) {
				abort(request, reason);
			}
		};
	};
	exports.renderToReadableStream = function(children, options) {
		return new Promise(function(resolve, reject) {
			var onFatalError, onAllReady, allReady = new Promise(function(res, rej) {
				onAllReady = res;
				onFatalError = rej;
			}), onHeaders = options ? options.onHeaders : void 0, onHeadersImpl;
			onHeaders && (onHeadersImpl = function(headersDescriptor) {
				onHeaders(new Headers(headersDescriptor));
			});
			var resumableState = createResumableState(options ? options.identifierPrefix : void 0, options ? options.unstable_externalRuntimeSrc : void 0, options ? options.bootstrapScriptContent : void 0, options ? options.bootstrapScripts : void 0, options ? options.bootstrapModules : void 0), request = createRequest(children, resumableState, createRenderState(resumableState, options ? options.nonce : void 0, options ? options.unstable_externalRuntimeSrc : void 0, options ? options.importMap : void 0, onHeadersImpl, options ? options.maxHeadersLength : void 0), createRootFormatContext(options ? options.namespaceURI : void 0), options ? options.progressiveChunkSize : void 0, options ? options.onError : void 0, options ? options.onBrowserBailout : void 0, onAllReady, function() {
				var writable, stream = new ReadableStream({
					type: "bytes",
					start: function(controller) {
						writable = createFakeWritableFromReadableStreamController$1(controller);
					},
					pull: function() {
						startFlowing(request, writable);
					},
					cancel: function(reason) {
						request.destination = null;
						abort(request, reason);
					}
				}, { highWaterMark: 0 });
				stream.allReady = allReady;
				resolve(stream);
			}, function(error) {
				allReady.catch(function() {});
				reject(error);
			}, onFatalError, options ? options.formState : void 0);
			options && options.signal && attachAbortSignal(request, options.signal);
			startWork(request);
		});
	};
	exports.resume = function(children, postponedState, options) {
		return new Promise(function(resolve, reject) {
			var onFatalError, onAllReady, allReady = new Promise(function(res, rej) {
				onAllReady = res;
				onFatalError = rej;
			}), request = resumeRequest(children, postponedState, createRenderState(postponedState.resumableState, options ? options.nonce : void 0, void 0, void 0, void 0, void 0), options ? options.onError : void 0, options ? options.onBrowserBailout : void 0, onAllReady, function() {
				var writable, stream = new ReadableStream({
					type: "bytes",
					start: function(controller) {
						writable = createFakeWritableFromReadableStreamController$1(controller);
					},
					pull: function() {
						startFlowing(request, writable);
					},
					cancel: function(reason) {
						request.destination = null;
						abort(request, reason);
					}
				}, { highWaterMark: 0 });
				stream.allReady = allReady;
				resolve(stream);
			}, function(error) {
				allReady.catch(function() {});
				reject(error);
			}, onFatalError);
			options && options.signal && attachAbortSignal(request, options.signal);
			startWork(request);
		});
	};
	exports.resumeAndPrerender = function(children, postponedState, options) {
		return new Promise(function(resolve, reject) {
			var request = resumeAndPrerenderRequest(children, postponedState, createRenderState(postponedState.resumableState, void 0, void 0, void 0, void 0, void 0), options ? options.onError : void 0, options ? options.onBrowserBailout : void 0, function() {
				var writable, stream = new ReadableStream({
					type: "bytes",
					start: function(controller) {
						writable = createFakeWritableFromReadableStreamController(controller);
					},
					pull: function() {
						startFlowing(request, writable);
					},
					cancel: function(reason) {
						request.destination = null;
						abort(request, reason);
					}
				}, { highWaterMark: 0 });
				stream = {
					postponed: getPostponedState(request),
					prelude: stream
				};
				resolve(stream);
			}, void 0, void 0, reject);
			options && options.signal && attachAbortSignal(request, options.signal);
			startWork(request);
		});
	};
	exports.resumeAndPrerenderToNodeStream = function(children, postponedState, options) {
		return new Promise(function(resolve, reject) {
			var request = resumeAndPrerenderRequest(children, postponedState, createRenderState(postponedState.resumableState, void 0, void 0, void 0, void 0, void 0), options ? options.onError : void 0, options ? options.onBrowserBailout : void 0, function() {
				var readable = new stream.Readable({ read: function() {
					startFlowing(request, writable);
				} }), writable = createFakeWritableFromReadable(readable);
				readable = {
					postponed: getPostponedState(request),
					prelude: readable
				};
				resolve(readable);
			}, void 0, void 0, reject);
			options && options.signal && attachAbortSignal(request, options.signal);
			startWork(request);
		});
	};
	exports.resumeToPipeableStream = function(children, postponedState, options) {
		var request = resumeRequestImpl(children, postponedState, options), hasStartedFlowing = !1;
		startWork(request);
		return {
			pipe: function(destination) {
				if (hasStartedFlowing) throw Error("React currently only supports piping to one writable stream.");
				hasStartedFlowing = !0;
				startFlowing(request, destination);
				destination.on("drain", createDrainHandler(destination, request));
				destination.on("error", createCancelHandler(request, "The destination stream errored while writing data."));
				destination.on("close", createCancelHandler(request, "The destination stream closed early."));
				return destination;
			},
			abort: function(reason) {
				abort(request, reason);
			}
		};
	};
	exports.version = "19.3.0";
}));
//#endregion
//#region app/lib/nonce.ts
var import_server_node = (/* @__PURE__ */ __commonJSMin(((exports) => {
	var l = require_react_dom_server_legacy_node_production();
	var s = require_react_dom_server_node_production();
	exports.version = l.version;
	exports.renderToString = l.renderToString;
	exports.renderToStaticMarkup = l.renderToStaticMarkup;
	exports.renderToPipeableStream = s.renderToPipeableStream;
	exports.renderToReadableStream = s.renderToReadableStream;
	exports.resumeToPipeableStream = s.resumeToPipeableStream;
	exports.resume = s.resume;
})))();
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
var NonceContext = (0, import_react.createContext)(void 0);
//#endregion
//#region node_modules/react/cjs/react-jsx-runtime.production.js
/**
* @license React
* react-jsx-runtime.production.js
*
* Copyright (c) Meta Platforms, Inc. and affiliates.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/
var require_react_jsx_runtime_production = /* @__PURE__ */ __commonJSMin(((exports) => {
	var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element");
	var REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
	function jsxProd(type, config, maybeKey) {
		var key = null;
		void 0 !== maybeKey && (key = "" + maybeKey);
		void 0 !== config.key && (key = "" + config.key);
		if ("key" in config) {
			maybeKey = {};
			for (var propName in config) "key" !== propName && (maybeKey[propName] = config[propName]);
		} else maybeKey = config;
		config = maybeKey.ref;
		return {
			$$typeof: REACT_ELEMENT_TYPE,
			type,
			key,
			ref: void 0 !== config ? config : null,
			props: maybeKey
		};
	}
	exports.Fragment = REACT_FRAGMENT_TYPE;
	exports.jsx = jsxProd;
	exports.jsxs = jsxProd;
}));
//#endregion
//#region node_modules/react/jsx-runtime.js
var require_jsx_runtime = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = require_react_jsx_runtime_production();
}));
//#endregion
//#region app/entry.server.tsx
/**
* Server rendering with the CSP nonce from the load context on every inline
* script React Router writes. Web streams, so the same bundle runs under
* Node and Bun. The page waits for all data before it answers: the store
* reads are local and quick, and one complete document is simpler to check.
*/
var entry_server_exports = /* @__PURE__ */ __exportAll({ default: () => handleRequest });
var import_jsx_runtime = require_jsx_runtime();
async function handleRequest(request, responseStatusCode, responseHeaders, routerContext, loadContext) {
	const { nonce } = loadContext;
	let status = responseStatusCode;
	const body = await (0, import_server_node.renderToReadableStream)(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NonceContext, {
		value: nonce,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ServerRouter, {
			context: routerContext,
			url: request.url,
			nonce
		})
	}), {
		nonce,
		signal: request.signal,
		onError(error) {
			status = 500;
			console.error(error);
		}
	});
	await body.allReady;
	responseHeaders.set("Content-Type", "text/html; charset=utf-8");
	return new Response(body, {
		headers: responseHeaders,
		status
	});
}
//#endregion
//#region app/components/kind.tsx
/** The strokes of each icon, in a 16 by 16 box. */
var PATHS$1 = {
	ritual: ["M3.3 5.8A5.2 5.2 0 0 1 12.7 5.8M13.4 2.9L12.7 5.8L10 4.4", "M12.7 10.2A5.2 5.2 0 0 1 3.3 10.2M2.6 13.1L3.3 10.2L6 11.6"],
	manual: [
		"M3.2 6.2V10.4C3.2 12.8 5 14.4 7.5 14.4C9.8 14.4 11.3 13.3 12.4 11.6L14.1 8.9A1.1 1.1 0 0 0 12.3 7.7L10.7 9.6",
		"M5.7 8.2V4M8.2 8.2V2.6M10.7 9.2V4",
		"M3.2 6.2V7.8"
	],
	vigil: ["M1.4 8C3 4.9 5.3 3.6 8 3.6C10.7 3.6 13 4.9 14.6 8C13 11.1 10.7 12.4 8 12.4C5.3 12.4 3 11.1 1.4 8Z", "M8 6.1A1.9 1.9 0 1 0 8 9.9A1.9 1.9 0 1 0 8 6.1Z"]
};
/** The icon of a kind, in the kind's colour. */
function KindIcon({ kind, size = 16, titled = false, className }) {
	const named = titled ? {
		role: "img",
		"aria-label": kind
	} : { "aria-hidden": true };
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", {
		className: `kind-icon kind-${kind}${className === void 0 ? "" : ` ${className}`}`,
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.6",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		focusable: "false",
		...named,
		children: PATHS$1[kind].map((path) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: path }, path))
	});
}
//#endregion
//#region app/components/nav-icons.tsx
var PATHS = {
	gear: ["M6.54 2.91L6.78 1.11L9.22 1.11L9.46 2.91L10.57 3.36L12.02 2.27L13.73 3.98L12.64 5.43L13.09 6.54L14.89 6.78L14.89 9.22L13.09 9.46L12.64 10.57L13.73 12.02L12.02 13.73L10.57 12.64L9.46 13.09L9.22 14.89L6.78 14.89L6.54 13.09L5.43 12.64L3.98 13.73L2.27 12.02L3.36 10.57L2.91 9.46L1.11 9.22L1.11 6.78L2.91 6.54L3.36 5.43L2.27 3.98L3.98 2.27L5.43 3.36Z", "M8 5.9A2.1 2.1 0 1 0 8 10.1A2.1 2.1 0 1 0 8 5.9Z"],
	milestone: ["M3.5 14.6V1.8", "M3.5 2.8H12.4L10.2 5.6L12.4 8.4H3.5"],
	chevron: ["M3.5 6L8 10.5L12.5 6"],
	check: ["M3 8.6L6.5 12L13 4.6"],
	workspace: ["M2.4 3.4H13.6V12.6H2.4Z", "M2.4 6.4H13.6"],
	all: [
		"M8 2L14.4 5.4L8 8.8L1.6 5.4Z",
		"M1.6 8.4L8 11.8L14.4 8.4",
		"M1.6 11.2L8 14.6L14.4 11.2"
	],
	status: ["M1.6 8.4H4.4L6.2 3.2L9.4 13L11.2 8.4H14.4"],
	overview: [
		"M1.8 7.6L8 2.3L14.2 7.6",
		"M3.6 6.6V13.7H12.4V6.6",
		"M6.6 13.7V9.6H9.4V13.7"
	]
};
function NavIcon({ name, size = 16, className }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", {
		className: className === void 0 ? "nav-icon" : `nav-icon ${className}`,
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.6",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		focusable: "false",
		"aria-hidden": "true",
		children: PATHS[name].map((path) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: path }, path))
	});
}
/** The brand mark: a cut gem, in four facets and a bright heart. The colours follow the theme. */
function Gem({ size = 28 }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", {
		className: "gem",
		width: size,
		height: size,
		viewBox: "0 0 32 32",
		focusable: "false",
		"aria-hidden": "true",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", {
			strokeWidth: "2",
			strokeLinejoin: "miter",
			className: "gem-g",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
					d: "M16 2 30 16 22 16 16 10Z",
					className: "gem-a"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
					d: "M30 16 16 30 16 22 22 16Z",
					className: "gem-b"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
					d: "M16 30 2 16 10 16 16 22Z",
					className: "gem-c"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
					d: "M2 16 16 2 16 10 10 16Z",
					className: "gem-b"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
					d: "M16 10 22 16 16 22 10 16Z",
					className: "gem-d"
				})
			]
		})
	});
}
//#endregion
//#region app/lib/format.ts
/** Text helpers for times, ids and commands. Pure, so server and client agree. */
var MINUTE = 6e4;
var HOUR$1 = 60 * MINUTE;
var DAY$2 = 24 * HOUR$1;
/** "3 min ago", "in 2 h", relative to `now` (ms). */
function relativeTime(iso, now) {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return iso;
	const delta = now - at;
	const size = Math.abs(delta);
	if (size < MINUTE) return "just now";
	const amount = size < HOUR$1 ? `${Math.round(size / MINUTE)} min` : size < DAY$2 ? `${Math.round(size / HOUR$1)} h` : `${Math.round(size / DAY$2)} d`;
	return delta >= 0 ? `${amount} ago` : `in ${amount}`;
}
function dayNumber(date) {
	return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY$2);
}
/** A YYYY-MM-DD date against the host's `today`: "today", "in 3 d", "2 d ago". */
function relativeDate(date, today) {
	const days = dayNumber(date) - dayNumber(today);
	if (Number.isNaN(days)) return date;
	if (days === 0) return "today";
	if (days === 1) return "tomorrow";
	if (days === -1) return "yesterday";
	return days > 0 ? `in ${days} d` : `${-days} d ago`;
}
/** Whole days from one YYYY-MM-DD date to another; negative when `to` is earlier. */
function dayGap(from, to) {
	return dayNumber(to) - dayNumber(from);
}
function pair(big, bigUnit, small, smallUnit) {
	return small === 0 ? `${big} ${bigUnit}` : `${big} ${bigUnit} ${small} ${smallUnit}`;
}
/** "4 min", "2 h 5 min", "1 d 3 h" between two ISO times. */
function duration(start, end) {
	const size = Date.parse(end) - Date.parse(start);
	if (Number.isNaN(size) || size < 0) return "";
	if (size < MINUTE) return `${Math.round(size / 1e3)} s`;
	if (size < HOUR$1) return `${Math.round(size / MINUTE)} min`;
	if (size < DAY$2) return pair(Math.floor(size / HOUR$1), "h", Math.round(size % HOUR$1 / MINUTE), "min");
	return pair(Math.floor(size / DAY$2), "d", Math.round(size % DAY$2 / HOUR$1), "h");
}
/** A long span in one coarse unit: "12 h", "3 d". */
function roughDuration(size) {
	if (size < HOUR$1) return `${Math.max(1, Math.round(size / MINUTE))} min`;
	if (size < 2 * DAY$2) return `${Math.floor(size / HOUR$1)} h`;
	return `${Math.floor(size / DAY$2)} d`;
}
/** A size in bytes as "812 B", "48 MiB" or "1.4 GiB": one decimal below 10, none above. */
function byteSize(bytes) {
	const units = [
		"B",
		"KiB",
		"MiB",
		"GiB",
		"TiB"
	];
	let value = Math.max(0, bytes);
	let at = 0;
	while (value >= 1024 && at < units.length - 1) {
		value /= 1024;
		at += 1;
	}
	return `${at === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1)} ${units[at] ?? "B"}`;
}
/** An uptime in seconds as "12 d 3 h", "5 h 10 min" or "4 min". */
function uptimeText(seconds) {
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${Math.max(1, minutes)} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return pair(hours, "h", minutes % 60, "min");
	return pair(Math.floor(hours / 24), "d", hours % 24, "h");
}
var WEEKDAYS = [
	"Sun",
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat"
];
var MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec"
];
/**
* A Date whose UTC fields read as the host's wall clock. `offset` is the
* host's UTC offset in minutes east (HostStatus.utcOffset), so the server and
* the browser print the same clock time whatever zone the browser is in.
*/
function wall(iso, offset) {
	const at = Date.parse(iso);
	return Number.isNaN(at) ? null : new Date(at + offset * MINUTE);
}
function two(value) {
	return String(value).padStart(2, "0");
}
/** "23:42" on the host's clock. */
function clockTime(iso, offset) {
	const date = wall(iso, offset);
	return date === null ? iso : `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
}
/** The host's local date of a moment, YYYY-MM-DD. */
function hostDate(iso, offset) {
	const date = wall(iso, offset);
	return date === null ? iso : date.toISOString().slice(0, 10);
}
/** "27 Sep" for a YYYY-MM-DD date. */
function shortDate(date) {
	const [, month = "", day = ""] = date.split("-");
	const name = MONTHS[Number(month) - 1];
	return name === void 0 ? date : `${Number(day)} ${name}`;
}
/** "Tue 29 Sep" for a moment, on the host's calendar. */
function dayName(iso, offset) {
	const date = wall(iso, offset);
	if (date === null) return iso;
	return `${WEEKDAYS[date.getUTCDay()] ?? ""} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ""}`;
}
/** A moment on the host's clock: "09:12" on `today`, "27 Sep 09:12" on another day. */
function momentText(iso, today, offset) {
	const date = hostDate(iso, offset);
	const time = clockTime(iso, offset);
	return date === today ? time : `${shortDate(date)} ${time}`;
}
/** The exact command that answers question `n` (1-based) of a held run. */
function answerCommand(run, n, project) {
	return `darius run answer ${run} ${n} "your answer" --project ${project}`;
}
/** The command that starts a ritual now, due or not, failed today or not. */
function runNowCommand(slug, project) {
	return `darius run now ${slug} --project ${project}`;
}
/** The command that marks a failed or abandoned run as seen. */
function ackCommand(run, project) {
	return `darius run ack ${run} --project ${project}`;
}
/** The command that records the operator's decision on the questions of a run's result. */
function decideCommand(run, project) {
	return `darius run ack ${run} --note "your decision" --project ${project}`;
}
/** The Overview of a workspace (a darius project). `/p/<project>` redirects here. */
function workspacePath(workspace) {
	return `/w/${encodeURIComponent(workspace)}`;
}
/** A section of a workspace, or of all workspaces when `workspace` is null: `/w/<ws>/vigils` or `/vigils`. */
function sectionPath(workspace, section) {
	return workspace === null ? `/${section}` : `${workspacePath(workspace)}/${section}`;
}
/** The detail pages keep the `/p/<project>` root. */
function detailRoot(project) {
	return `/p/${encodeURIComponent(project)}`;
}
function ritualPath(project, slug) {
	return `${detailRoot(project)}/rituals/${encodeURIComponent(slug)}`;
}
function runPath(project, run) {
	return `${detailRoot(project)}/runs/${encodeURIComponent(run)}`;
}
/** The id of a vigil row on the Vigils page. */
function vigilAnchor(slug) {
	return `vigil-${slug}`;
}
/** Where a vigil lives: its row on the Vigils page of its workspace. */
function vigilPath(project, slug) {
	return `${sectionPath(project, "vigils")}#${encodeURIComponent(vigilAnchor(slug))}`;
}
/** Where an item (`ritual/<slug>` or `vigil/<slug>`) lives on the page. */
function itemPath(project, item) {
	const [kind = "", slug = ""] = item.split("/");
	if (kind === "ritual") return ritualPath(project, slug);
	return vigilPath(project, slug);
}
//#endregion
//#region app/lib/kind.ts
/** True when darius itself starts this ritual. */
function isUnattended(ritual) {
	return ritual.mode !== "off" && ritual.lifecycle === "active";
}
/** True when a person does this ritual by hand: darius never starts it. */
function isManual(ritual) {
	return !isUnattended(ritual);
}
/** The kind of a run's item (`ritual/<slug>` or `vigil/<slug>`). */
function itemKind(item) {
	return item.startsWith("vigil/") ? "vigil" : "ritual";
}
/**
* Whether a run's item is a manual ritual. A ritual that the status no longer
* lists counts as one darius runs, since only such a ritual leaves runs behind.
*/
function itemManual(item, ritual) {
	return !item.startsWith("vigil/") && ritual !== void 0 && isManual(ritual);
}
/** The word that names a kind on a chip. */
function kindWord(kind) {
	return kind;
}
//#endregion
//#region app/lib/state-words.ts
/** Days ahead that read as a weekday date ("Fri 2 Oct"); a later date reads "15 Nov". */
var WEEKDAY_DAYS = 14;
var RUNNING = {
	tone: "run",
	label: "Running"
};
var WAITING_FOR_YOU = {
	tone: "wait",
	label: "Waiting for you"
};
var ASKS_YOU = {
	tone: "wait",
	label: "Asks you"
};
var FAILED = {
	tone: "bad",
	label: "Failed"
};
var FAILED_SEEN = {
	tone: "idle",
	label: "Failed, seen"
};
var ABANDONED = {
	tone: "idle",
	label: "Abandoned"
};
var COMPLETE = {
	tone: "ok",
	label: "Complete"
};
var DUE_TODAY = {
	tone: "gold",
	label: "Due today"
};
var FLAGGED = {
	tone: "bad",
	label: "Flagged"
};
/** "1 day late", "13 days late". */
function lateWord(days) {
	return {
		tone: "late",
		label: `${days} day${days === 1 ? "" : "s"} late`
	};
}
/** "tomorrow", "Fri 2 Oct" within two weeks, "15 Nov" later; "today" for today. */
function datePhrase(today, date) {
	const gap = dayGap(today, date);
	if (gap <= 0) return "today";
	if (gap === 1) return "tomorrow";
	return gap <= WEEKDAY_DAYS ? dayName(`${date}T00:00:00Z`, 0) : shortDate(date);
}
/** The state of a ritual or vigil by its date: late, due today, or the date phrase. Null without a date. */
function dateState(today, date) {
	if (date === null) return null;
	const gap = dayGap(today, date);
	if (gap < 0) return lateWord(-gap);
	if (gap === 0) return DUE_TODAY;
	return {
		tone: "idle",
		label: datePhrase(today, date)
	};
}
/** A closed run's state from its outcome; other outcomes are the outcome in words, quiet. */
function closedWord(outcome) {
	if (outcome === "failed") return FAILED;
	if (outcome === "abandoned") return ABANDONED;
	if (outcome === null) return {
		tone: "idle",
		label: "Closed"
	};
	return {
		tone: "idle",
		label: outcome.charAt(0).toUpperCase() + outcome.slice(1)
	};
}
/**
* How a run ended, in words and a tone. A failure a person acknowledged
* (`darius run ack`) is quiet everywhere: "Failed, seen" in grey. A complete
* run that asks a question is not "Complete" until someone answered it.
*/
function runWord(run, asksYou) {
	if (run.phase === "held") return WAITING_FOR_YOU;
	if (run.phase === "running") return RUNNING;
	if (asksYou) return ASKS_YOU;
	if (run.outcome === "complete") return COMPLETE;
	const word = closedWord(run.outcome);
	return run.acknowledged !== null && word === FAILED ? FAILED_SEEN : word;
}
/** The state of a ritual: waiting, running, late, due today, or when it is next due. */
function ritualWord(ritual, today) {
	if (ritual.heldRun !== null) return WAITING_FOR_YOU;
	if (ritual.openRun !== null) return RUNNING;
	if (ritual.lifecycle !== "active") return {
		tone: "idle",
		label: ritual.lifecycle.charAt(0).toUpperCase() + ritual.lifecycle.slice(1)
	};
	if (ritual.overdueDays > 0) return lateWord(ritual.overdueDays);
	if (ritual.nextDue === null) return {
		tone: "idle",
		label: "No schedule"
	};
	return dateState(today, ritual.nextDue) ?? {
		tone: "idle",
		label: "No schedule"
	};
}
/** The state of a vigil: its verdict when closed, flagged, or nothing (an armed vigil is just armed). */
function vigilWord(vigil) {
	if (vigil.state === "closed") return vigil.verdict === "failed" ? FAILED : {
		tone: "ok",
		label: vigil.verdict === null ? "Closed" : vigil.verdict.charAt(0).toUpperCase() + vigil.verdict.slice(1)
	};
	return vigil.flagged ? FLAGGED : null;
}
/** The rail of a state: only a state that needs attention draws one (late, running, waiting, asks, failed, flagged). */
function railOf(state) {
	return state === null || state.tone === "idle" || state.tone === "ok" || state.tone === "gold" ? null : state.tone;
}
//#endregion
//#region app/lib/view.ts
/** A djinn: a ritual darius runs that follows a repo skill. */
function isDjinn(ritual) {
	return isUnattended(ritual) && ritual.skill !== null;
}
/** Runs that `darius import` copied from the legacy tracker: history, not activity. */
function isImported(run) {
	return run.who === "import";
}
function itemSlug(item) {
	return item.split("/")[1] ?? item;
}
/** The human name of an item (`ritual/<slug>` or `vigil/<slug>`) in a project, or its slug. */
function itemLabel(project, item) {
	const [kind = "", slug = item] = item.split("/");
	return (kind === "vigil" ? project?.vigils.find((vigil) => vigil.slug === slug) : project?.rituals.find((ritual) => ritual.slug === slug))?.title ?? slug;
}
/** The runs of these projects, newest first, each with a readable label. */
function activity(projects, opts) {
	return projects.flatMap((project) => project.runs.filter((run) => opts.withImported || !isImported(run)).map((run) => Object.assign({}, run, {
		project: project.name,
		slug: itemSlug(run.item),
		label: itemLabel(project, run.item),
		kind: itemKind(run.item),
		manual: itemManual(run.item, project.rituals.find((ritual) => ritual.slug === itemSlug(run.item)))
	}))).toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}
/**
* A complete run whose result asks the operator something (0.22.0), and
* nobody answered yet: it waits for `darius run ack --note`, like a held run
* waits for an answer.
*/
function asksYou(run) {
	return run.phase === "closed" && run.outcome === "complete" && (run.result?.questions ?? 0) > 0 && run.acknowledged === null;
}
/** How a run ended, in words and a tone (the table in `state-words.ts`). */
function runState(run) {
	return runWord(run, asksYou(run));
}
/** A run still open after this long has outlived the timeout by far: it may be stuck. */
var STUCK_AFTER_MS = 72e5;
/**
* How long a running run has run, in words, when that is past the stuck
* limit; null otherwise. Measured against the status time, not the browser
* clock, so server and client render the same text.
*/
function stuckFor(run, generatedAt) {
	if (run.phase !== "running") return null;
	const size = Date.parse(generatedAt) - Date.parse(run.startedAt);
	if (Number.isNaN(size) || size < STUCK_AFTER_MS) return null;
	return roughDuration(size);
}
/** The warning line for a stuck run. */
function stuckText(runningFor) {
	return `Running for ${runningFor}. Runs stop after 20 min, so this one may be stuck.`;
}
/** "every day", "every 7 days", "every week"; null without a cadence. */
function cadenceText(cadence) {
	if (cadence === null) return null;
	const match = /^(\d+)\s*([hdwm])$/u.exec(cadence.trim());
	if (match === null) return `every ${cadence}`;
	const count = Number(match[1]);
	const unit = {
		h: "hour",
		d: "day",
		w: "week",
		m: "month"
	}[match[2] ?? "d"] ?? "day";
	return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
}
/** "Acknowledged by owner at 09:12: known outage." Store text, shown as text. */
function ackText(ack, clock) {
	const lead = `Acknowledged by ${ack.who} at ${momentText(ack.at, clock.today, clock.offset)}`;
	if (ack.note === null || ack.note.trim() === "") return `${lead}.`;
	const note = ack.note.trim();
	return /[.!?]$/u.test(note) ? `${lead}: ${note}` : `${lead}: ${note}.`;
}
/** "Answered by owner at 09:12: yes, delete them." The decision on a result's questions, from the acknowledgement. */
function decisionText(ack, clock) {
	const lead = `Answered by ${ack.who} at ${momentText(ack.at, clock.today, clock.offset)}`;
	if (ack.note === null || ack.note.trim() === "") return `${lead}, without a note.`;
	const note = ack.note.trim();
	return /[.!?]$/u.test(note) ? `${lead}: ${note}` : `${lead}: ${note}.`;
}
function nextStep(failure, clock) {
	if (failure.acknowledged !== null) return {
		kind: "seen",
		text: ackText(failure.acknowledged, clock)
	};
	const failed = failure.outcome === "failed";
	const verb = failed ? "failed" : "was abandoned";
	const text = failure.endedOn === clock.today ? `This run ${verb}. darius does not retry it today. The timer starts the ritual again when it is next due, tomorrow for a daily ritual.` : `This run ${verb} on ${shortDate(failure.endedOn)}. The timer starts the ritual again when it is next due.`;
	return {
		kind: "open",
		tone: failed ? "bad" : "idle",
		text,
		runNow: runNowCommand(failure.slug, failure.project),
		ack: ackCommand(failure.run, failure.project)
	};
}
/** The failure a run page shows a next step for: a closed ritual run that failed or was abandoned; null for any other run. */
function runFailure(project, run, offset) {
	const { phase, outcome, item } = run;
	if (phase !== "closed" || outcome !== "failed" && outcome !== "abandoned" || !item.startsWith("ritual/")) return null;
	return {
		project,
		slug: itemSlug(item),
		run: run.run,
		outcome,
		endedOn: hostDate(run.endedAt ?? run.startedAt, offset),
		acknowledged: run.acknowledged
	};
}
/** The failure a ritual page shows a next step for: its run that failed today; null when none did. */
function ritualFailure(project, ritual, runs, today) {
	const failed = ritual.failedToday;
	if (failed === null) return null;
	const outcome = runs.find((run) => run.run === failed.run)?.outcome ?? "failed";
	return {
		project,
		slug: ritual.slug,
		run: failed.run,
		outcome,
		endedOn: today,
		acknowledged: failed.acknowledged
	};
}
function lineText(line) {
	return line.map((span) => span.text).join("");
}
var EXCERPT_ITEMS = 3;
/** The most characters an excerpt shows: about four lines on a phone. */
var EXCERPT_CHARS = 200;
/** The spans of a line that fit in `budget` characters, cut at a word boundary. */
function clipLine(line, budget) {
	const kept = [];
	let used = 0;
	for (const span of line) {
		if (used + span.text.length <= budget) {
			kept.push(span);
			used += span.text.length;
			continue;
		}
		const room = budget - used;
		const head = span.text.slice(0, room + 1);
		const cut = span.kind === "code" || !/\s/u.test(head) ? "" : head.replace(/\s+\S*$/u, "").replace(/[\s,;:.(-]+$/u, "");
		if (cut !== "") kept.push({
			kind: span.kind,
			text: cut
		});
		kept.push({
			kind: "text",
			text: "…"
		});
		return {
			line: kept,
			used: budget,
			clipped: true
		};
	}
	return {
		line: kept,
		used,
		clipped: false
	};
}
/** A paragraph or list clipped to `budget` characters. */
function clipBlock(block, budget) {
	if (block.kind !== "paragraph" && block.kind !== "list") return {
		block,
		used: 0
	};
	const source = block.kind === "paragraph" ? block.lines : block.items;
	const lines = [];
	let used = 0;
	for (const line of source) {
		if (used >= budget) break;
		const clip = clipLine(line, budget - used);
		lines.push(clip.line);
		used += clip.used;
		if (clip.clipped) break;
	}
	return {
		block: block.kind === "paragraph" ? {
			...block,
			lines
		} : {
			...block,
			items: lines
		},
		used
	};
}
/** The first heading and paragraph of a report, the paragraph cut to `chars` characters. */
function excerpt(findings, chars = EXCERPT_CHARS) {
	if (findings === null || findings.length === 0) return null;
	const first = findings[0];
	const headline = first?.kind === "heading" ? lineText(first.content) : null;
	const rest = headline === null ? findings : findings.slice(1);
	const blocks = [];
	for (const block of rest) {
		if (block.kind === "heading") {
			if (blocks.length > 0) break;
			continue;
		}
		if (block.kind === "list") blocks.push(clipBlock({
			...block,
			items: block.items.slice(0, EXCERPT_ITEMS)
		}, chars).block);
		else if (block.kind === "paragraph") blocks.push(clipBlock(block, chars).block);
		if (blocks.length >= 1) break;
	}
	return {
		headline,
		blocks
	};
}
/** The report of a run, when it has one. */
function reportExcerpt(detail) {
	return detail === null ? null : excerpt(detail.findings);
}
//#endregion
//#region app/lib/agenda.ts
var DAY$1 = 864e5;
function addDays(date, days) {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY$1).toISOString().slice(0, 10);
}
/** "Fri 2 Oct" for a YYYY-MM-DD date. */
function weekdayDate(date) {
	return dayName(`${date}T00:00:00Z`, 0);
}
function groupOf$1(today, date, overdue) {
	if (date === null) return {
		key: "none",
		kind: "none",
		label: "No schedule"
	};
	if (overdue) return {
		key: "overdue",
		kind: "overdue",
		label: "Overdue"
	};
	const gap = dayGap(today, date);
	if (gap <= 0) return {
		key: "today",
		kind: "today",
		label: "Today"
	};
	if (gap === 1) return {
		key: "tomorrow",
		kind: "tomorrow",
		label: "Tomorrow"
	};
	if (gap <= 14) return {
		key: `d-${date}`,
		kind: "day",
		label: weekdayDate(date)
	};
	return {
		key: "later",
		kind: "later",
		label: "Later"
	};
}
/** "every 7 days, last done 14 Sep": the cadence in words, then when it was last done. */
function factsText(ritual) {
	const cadence = cadenceText(ritual.cadence);
	const done = ritual.lastCompleted === null ? "not done yet" : `last done ${shortDate(ritual.lastCompleted)}`;
	return cadence === null ? done : `${cadence}, ${done}`;
}
/** Runs that count: imports and install proofs are history, not activity. */
function isNoise$1(run) {
	return run.who === "import" || run.who === "acceptance";
}
/** Whether the newest counted run of a ritual is a complete run that asks the operator something. */
function asksNow(project, ritual) {
	const last = project.runs.filter((run) => run.item === `ritual/${ritual.slug}` && !isNoise$1(run)).toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
	return last !== void 0 && asksYou(last);
}
function placement(input, project, ritual) {
	const { today } = input;
	if (ritual.heldRun !== null) return {
		date: today,
		overdueDays: 0,
		state: WAITING_FOR_YOU
	};
	if (ritual.openRun !== null) return {
		date: today,
		overdueDays: 0,
		state: RUNNING
	};
	if (ritual.failedToday !== null) {
		const seen = ritual.failedToday.acknowledged !== null;
		return {
			date: addDays(today, 1),
			overdueDays: 0,
			state: seen ? FAILED_SEEN : FAILED
		};
	}
	const asks = asksNow(project, ritual) ? ASKS_YOU : null;
	if (ritual.nextDue === null) return {
		date: null,
		overdueDays: 0,
		state: asks
	};
	const late = Math.max(ritual.overdueDays, dayGap(ritual.nextDue, today));
	if (late > 0) return {
		date: ritual.nextDue,
		overdueDays: late,
		state: lateWord(late)
	};
	return {
		date: ritual.nextDue <= today ? today : ritual.nextDue,
		overdueDays: 0,
		state: asks
	};
}
function ritualRow(input, project, ritual) {
	const at = placement(input, project, ritual);
	return {
		key: `${project.name}/ritual/${ritual.slug}`,
		kind: "ritual",
		manual: isManual(ritual),
		project: project.name,
		slug: ritual.slug,
		title: ritual.title,
		href: ritualPath(project.name, ritual.slug),
		date: at.date,
		rail: railOf(at.state),
		state: at.state,
		facts: factsText(ritual),
		until: null,
		note: null,
		overdueDays: at.overdueDays
	};
}
function isArmed(vigil) {
	return vigil.state !== "closed";
}
function vigilRow(input, project, vigil, due) {
	const late = Math.max(0, dayGap(due, input.today));
	const noted = vigil.flagged ? [vigil.lastOutcome === null ? null : `last check ${vigil.lastOutcome}`, late > 0 ? lateWord(late).label : null].filter((part) => part !== null) : [];
	const note = noted.length === 0 ? null : noted.join(", ");
	const state = vigil.flagged ? FLAGGED : late > 0 ? lateWord(late) : null;
	return {
		key: `${project.name}/vigil/${vigil.slug}`,
		kind: "vigil",
		manual: false,
		project: project.name,
		slug: vigil.slug,
		title: vigil.title,
		href: vigilPath(project.name, vigil.slug),
		date: due,
		rail: railOf(state),
		state,
		facts: "",
		until: vigil.until,
		note,
		overdueDays: late
	};
}
function waitingRow(project, vigil) {
	return {
		key: `${project.name}/vigil/${vigil.slug}`,
		project: project.name,
		slug: vigil.slug,
		title: vigil.title,
		href: vigilPath(project.name, vigil.slug),
		until: vigil.until,
		flagged: vigil.flagged
	};
}
/** Rituals darius runs lead their day; manual rituals and vigils follow, by title. */
function ritualFirst(row) {
	return row.kind === "ritual" && !row.manual ? 0 : 1;
}
/** Overdue: the latest first. Other groups: the date, rituals darius runs first, then the title. */
function byRow(left, right) {
	return right.overdueDays - left.overdueDays || (left.date ?? "").localeCompare(right.date ?? "") || ritualFirst(left) - ritualFirst(right) || left.title.localeCompare(right.title);
}
function byWaiting(left, right) {
	return Number(right.flagged) - Number(left.flagged) || left.title.localeCompare(right.title);
}
var GROUP_ORDER = {
	overdue: 0,
	today: 1,
	tomorrow: 2,
	day: 3,
	later: 4,
	none: 5
};
function buildAgenda(input) {
	const rows = [];
	const waiting = [];
	let armed = 0;
	for (const project of input.projects) {
		for (const ritual of input.only === "vigil" ? [] : project.rituals) if (ritual.lifecycle === "active") rows.push(ritualRow(input, project, ritual));
		for (const vigil of (input.only === "ritual" ? [] : project.vigils).filter((candidate) => isArmed(candidate))) {
			armed += 1;
			if (vigil.due === null) waiting.push(waitingRow(project, vigil));
			else rows.push(vigilRow(input, project, vigil, vigil.due));
		}
	}
	const groups = /* @__PURE__ */ new Map();
	for (const row of rows.toSorted(byRow)) {
		const spec = groupOf$1(input.today, row.date, row.overdueDays > 0);
		const found = groups.get(spec.key);
		if (found === void 0) groups.set(spec.key, {
			...spec,
			rows: [row],
			order: GROUP_ORDER[spec.kind],
			date: row.date ?? ""
		});
		else found.rows.push(row);
	}
	const ordered = [...groups.values()].toSorted((left, right) => left.order - right.order || left.date.localeCompare(right.date)).map(({ key, kind, label, rows: members }) => ({
		key,
		kind,
		label,
		rows: members
	}));
	const dated = ordered.filter((group) => group.kind !== "overdue" && group.kind !== "none").flatMap((group) => group.rows);
	const today = ordered.find((group) => group.kind === "today");
	return {
		groups: ordered,
		waiting: waiting.toSorted(byWaiting),
		showProject: (/* @__PURE__ */ new Set([...rows.map((row) => row.project), ...waiting.map((row) => row.project)])).size > 1,
		next: dated[0] ?? null,
		overdue: ordered.find((group) => group.kind === "overdue")?.rows.length ?? 0,
		dueToday: today?.rows.filter((row) => row.state === null || row.state !== RUNNING && row.state !== WAITING_FOR_YOU).length ?? 0,
		armed
	};
}
/** The first dated row that is not overdue (the strip already counts the overdue ones); null when there is none. */
function nextLine(agenda, today) {
	const row = agenda.next;
	if (row === null || row.date === null) return null;
	const when = datePhrase(today, row.date);
	return {
		title: row.title,
		href: row.href,
		kind: row.kind,
		manual: row.manual,
		when,
		isToday: when === "today"
	};
}
/** The rows a phone hides until "Show more": past Tomorrow, after the first few. */
function phoneHidden(agenda) {
	const hidden = /* @__PURE__ */ new Set();
	let shown = 0;
	for (const group of agenda.groups) {
		const always = group.kind === "overdue" || group.kind === "today" || group.kind === "tomorrow";
		for (const row of group.rows) {
			if (always) continue;
			shown += 1;
			if (shown > 6) hidden.add(row.key);
		}
	}
	return hidden;
}
/** The groups a desktop keeps in a closed fold. */
function isFolded(group) {
	return group.kind === "later" || group.kind === "none";
}
//#endregion
//#region app/lib/tone.ts
var BAD_OUTCOMES = /* @__PURE__ */ new Set([
	"failed",
	"refused",
	"error",
	"gate-broken",
	"harness-unchecked",
	"profile-invalid",
	"subagents-unproven",
	"tool-missing"
]);
function outcomeTone(outcome) {
	if (outcome === null) return "idle";
	if (outcome === "complete" || outcome === "done" || outcome === "ok") return "ok";
	if (BAD_OUTCOMES.has(outcome)) return "bad";
	return "idle";
}
//#endregion
//#region app/lib/home.ts
var HOUR = 36e5;
var DAY = 24 * HOUR;
/** A sync older than this shows in the overdue colour. */
var SYNC_STALE_MS = 2 * HOUR;
/** Report excerpts: the characters sent, and the size past which the last line fades out. */
var NEED_CHARS = 480;
var NEED_FADE = 260;
var DONE_CHARS = 320;
var DONE_FADE = 190;
/** The project that tests darius itself (`darius selftest`). A project named `darius` is a real project, not a test. */
var SELFTEST_PROJECTS = /* @__PURE__ */ new Set(["darius-selftest"]);
function isSelftest(project) {
	return SELFTEST_PROJECTS.has(project);
}
/** Runs home never shows: copies from the legacy tracker and install proofs. */
function isNoise(run) {
	return run.who === "import" || run.who === "acceptance";
}
var NUMBER_WORDS = [
	"Nothing",
	"One",
	"Two",
	"Three",
	"Four",
	"Five",
	"Six",
	"Seven",
	"Eight",
	"Nine",
	"Ten",
	"Eleven",
	"Twelve"
];
/**
* "Nothing needs you.", "One thing needs you.", "Four things need you." In
* words, because the Cinzel 1 reads as an I.
*/
function verdictText(count) {
	if (count === 0) return "Nothing needs you.";
	const word = NUMBER_WORDS[count] ?? String(count);
	return count === 1 ? `${word} thing needs you.` : `${word} things need you.`;
}
function plural$1(count, noun) {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function byText(who) {
	return who === "timer" ? "by timer" : `by ${who}`;
}
/** "12 h ago" within a day, otherwise "27 Sep". */
function when(clock, iso) {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return iso;
	const size = clock.now - at;
	if (size >= DAY) return shortDate(hostDate(iso, clock.offset));
	if (size < 6e4) return "just now";
	return `${roughDuration(size)} ago`;
}
/** "12 h ago" or "on 27 Sep", to follow a verb. */
function whenPhrase(clock, iso) {
	const text = when(clock, iso);
	return /\d{1,2} [A-Z][a-z]{2}$/u.test(text) ? `on ${text}` : text;
}
/** "today 00:05" or "28 Sep 23:42". */
function startedText(clock, iso) {
	const date = hostDate(iso, clock.offset);
	return `${date === clock.today ? "today" : shortDate(date)} ${clockTime(iso, clock.offset)}`;
}
function blocksSize(blocks) {
	return blocks.reduce((sum, block) => {
		if (block.kind === "paragraph") return sum + block.lines.flat().reduce((size, span) => size + span.text.length, 0);
		if (block.kind === "list") return sum + block.items.flat().reduce((size, span) => size + span.text.length, 0) + block.items.length * 40;
		return sum;
	}, 0);
}
function djinnState(clock, project, ritual, runs) {
	const own = runs.filter((run) => run.project === project && run.item === `ritual/${ritual.slug}`);
	const last = own[0] ?? null;
	const waiting = ritual.heldRun !== null || ritual.openRun !== null;
	const ranToday = own.some((run) => hostDate(run.startedAt, clock.offset) === clock.today);
	return {
		project,
		ritual,
		last,
		missed: ritual.isDue && ritual.overdueDays >= 1 && !waiting && !ranToday
	};
}
function blank(id, kind, item, manual = false) {
	return {
		id,
		kind,
		item,
		manual,
		edge: null,
		word: {
			text: "",
			ink: "plain"
		},
		side: null,
		title: "",
		href: "",
		meta: [],
		meta2: null,
		questions: [],
		ask: null,
		report: null,
		fades: false,
		error: null,
		actions: []
	};
}
function historyHref(run) {
	return run.item.startsWith("vigil/") ? vigilPath(run.project, run.slug) : ritualPath(run.project, run.slug);
}
function heldCard(clock, run) {
	return {
		...blank(`held-${run.run}`, "held", run.kind, run.manual),
		edge: "wait",
		word: {
			text: WAITING_FOR_YOU.label,
			ink: WAITING_FOR_YOU.tone
		},
		side: {
			text: when(clock, run.startedAt),
			ink: "plain"
		},
		title: run.label,
		href: runPath(run.project, run.run),
		meta: [
			run.project,
			byText(run.who),
			run.questions.length === 0 ? null : plural$1(run.questions.length, "question")
		].filter((part) => part !== null),
		questions: run.questions.map((text, index) => ({
			text,
			command: answerCommand(run.run, index + 1, run.project)
		})),
		actions: [{
			text: "History",
			href: historyHref(run)
		}]
	};
}
/** A complete run whose result asks the operator something: its questions, with the command that records the decision. */
function asksCard(clock, readRun, run) {
	const count = run.result?.questions ?? 0;
	const result = readRun(run.project, run.run)?.result ?? null;
	return {
		...blank(`asks-${run.run}`, "asks", run.kind, run.manual),
		edge: "wait",
		word: {
			text: ASKS_YOU.label,
			ink: ASKS_YOU.tone
		},
		side: {
			text: when(clock, run.endedAt ?? run.startedAt),
			ink: "plain"
		},
		title: run.label,
		href: runPath(run.project, run.run),
		meta: [
			run.project,
			byText(run.who),
			plural$1(count, "question")
		],
		meta2: result === null ? null : result.summary,
		ask: {
			questions: result === null ? [] : result.questions,
			command: decideCommand(run.run, run.project)
		},
		actions: [{
			text: "Open the run",
			href: runPath(run.project, run.run)
		}, {
			text: "History",
			href: historyHref(run)
		}]
	};
}
function reportOf(readRun, run, chars, fade) {
	if (run.findingsSha === null) return {
		report: null,
		fades: false
	};
	const report = excerpt(readRun(run.project, run.run)?.findings ?? null, chars);
	return {
		report,
		fades: report !== null && blocksSize(report.blocks) > fade
	};
}
function tookText(run) {
	return run.endedAt === null ? null : `took ${duration(run.startedAt, run.endedAt)}`;
}
/** A failed run nobody acknowledged yet: it needs the operator. */
function isOpenFailure(run) {
	return run.phase === "closed" && outcomeTone(run.outcome) === "bad" && run.acknowledged === null;
}
/** A run for the Last night cards: it completed and asks nothing open, or it failed and a person acknowledged it. */
function isDone(run) {
	if (asksYou(run)) return false;
	return run.phase === "closed" && (run.outcome === "complete" || outcomeTone(run.outcome) === "bad" && run.acknowledged !== null);
}
/** Who acknowledged a run: the decision on a result's questions, or who saw a failure. */
function seenText$1(run, clock) {
	const seen = run.acknowledged;
	if (seen === null) return null;
	return (run.result?.questions ?? 0) > 0 ? decisionText(seen, clock) : ackText(seen, clock);
}
function finishedCard(clock, readRun, state, run) {
	const failed = isOpenFailure(run);
	const badge = runState(run);
	const report = failed ? reportOf(readRun, run, NEED_CHARS, NEED_FADE) : reportOf(readRun, run, DONE_CHARS, DONE_FADE);
	return {
		...blank(`${failed ? "failed" : "done"}-${state.project}-${state.ritual.slug}`, failed ? "failed" : "done", "ritual", isManual(state.ritual)),
		edge: failed ? "bad" : null,
		word: {
			text: badge.label,
			ink: badge.tone
		},
		side: {
			text: when(clock, run.startedAt),
			ink: "plain"
		},
		title: state.ritual.title,
		href: runPath(run.project, run.run),
		meta: [
			state.project,
			byText(run.who),
			tookText(run)
		].filter((part) => part !== null),
		meta2: seenText$1(run, clock),
		...report,
		actions: [{
			text: run.findingsSha === null ? "Open the run" : "Read the report",
			href: runPath(run.project, run.run)
		}, {
			text: "History",
			href: ritualPath(state.project, state.ritual.slug)
		}]
	};
}
function stuckCard(clock, run, stuck) {
	return {
		...blank(`stuck-${run.run}`, "stuck", run.kind, run.manual),
		edge: "late",
		word: {
			text: RUNNING.label,
			ink: RUNNING.tone
		},
		side: {
			text: `stuck, ${stuck}`,
			ink: "late"
		},
		title: run.label,
		href: runPath(run.project, run.run),
		meta: [
			run.project,
			byText(run.who),
			`started ${startedText(clock, run.startedAt)}`
		],
		actions: [{
			text: "Open the run",
			href: runPath(run.project, run.run)
		}, {
			text: "History",
			href: historyHref(run)
		}]
	};
}
function vigilWaitText(vigil, today) {
	return [vigil.due === null ? null : `due ${relativeDate(vigil.due, today)}`, vigil.until === null ? null : `waits for ${vigil.until}`].filter((part) => part !== null);
}
function flaggedCard(clock, project, vigil, runs, generatedAt) {
	const check = runs.find((run) => run.project === project.name && run.item === `vigil/${vigil.slug}` && run.phase === "running");
	const meta = [
		project.name,
		vigil.lastOutcome === null ? null : `last check ${vigil.lastOutcome}`,
		...vigilWaitText(vigil, clock.today)
	].filter((part) => part !== null);
	const size = check === void 0 ? 0 : clock.now - Date.parse(check.startedAt);
	return {
		...blank(`flagged-${project.name}-${vigil.slug}`, "flagged", "vigil"),
		edge: "bad",
		word: {
			text: FLAGGED.label,
			ink: FLAGGED.tone
		},
		title: vigil.title,
		href: vigilPath(project.name, vigil.slug),
		meta,
		meta2: check === void 0 ? null : `A new check is running, ${byText(check.who)}, ${roughDuration(size)} so far.${stuckFor(check, generatedAt) === null ? "" : " It may be stuck."}`,
		actions: [{
			text: "Open the vigil",
			href: vigilPath(project.name, vigil.slug)
		}]
	};
}
function unreadableCard(project) {
	return {
		...blank(`unreadable-${project.name}`, "unreadable", null),
		edge: "bad",
		word: {
			text: "Unreadable",
			ink: "bad"
		},
		title: project.name,
		href: workspacePath(project.name),
		meta: ["darius could not read this project"],
		error: project.error,
		actions: [{
			text: "Open the workspace",
			href: workspacePath(project.name)
		}]
	};
}
/**
* The hourly run-due timer. The status has no timer log, so the line reads
* the runs: the newest run the timer started anywhere (the self-test counts,
* it proves the timer fires), and the djinns that are overdue but did not
* start today.
*/
function timerPiece(clock, status, states) {
	const last = status.projects.flatMap((project) => project.runs).filter((run) => run.who === "timer").toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
	const missed = states.filter((state) => state.missed).length;
	if (missed > 0) {
		if (last === void 0) return {
			text: "Timer never ran.",
			ink: "late"
		};
		if (hostDate(last.startedAt, clock.offset) !== clock.today) return {
			text: `Timer silent since ${shortDate(hostDate(last.startedAt, clock.offset))}.`,
			ink: "late"
		};
		return {
			text: `Timer: ${plural$1(missed, "djinn")} not started.`,
			ink: "late"
		};
	}
	if (last === void 0) return {
		text: "Timer has no run yet.",
		ink: "mute"
	};
	return {
		text: `Timer ok, last run ${when(clock, last.startedAt)}.`,
		ink: "plain"
	};
}
function syncPiece(clock, status) {
	const last = status.projects.map((project) => project.lastSync).filter((sync) => sync !== null).toSorted().at(-1);
	if (last === void 0) return {
		text: " Never synced.",
		ink: "mute"
	};
	const stale = clock.now - Date.parse(last) > SYNC_STALE_MS;
	return {
		text: ` Synced ${when(clock, last)}.`,
		ink: stale ? "late" : "plain"
	};
}
function projectNeeds(clock, generatedAt, project) {
	const runs = activity([project], { withImported: false }).filter((run) => !isNoise(run));
	const states = project.rituals.filter((ritual) => isDjinn(ritual)).map((ritual) => djinnState(clock, project.name, ritual, runs));
	const flagged = project.vigils.filter((vigil) => vigil.flagged);
	const flaggedChecks = new Set(flagged.map((vigil) => `vigil/${vigil.slug}`));
	const stuck = runs.flatMap((run) => {
		const size = stuckFor(run, generatedAt);
		return size === null || flaggedChecks.has(run.item) ? [] : [{
			run,
			size
		}];
	});
	return {
		project,
		runs,
		states,
		held: runs.filter((run) => run.phase === "held"),
		asks: runs.filter((run) => asksYou(run)),
		failed: states.filter((state) => state.last !== null && isOpenFailure(state.last)),
		stuck,
		flagged,
		unreadable: project.error !== null
	};
}
function needsSize(needs) {
	return needs.held.length + needs.asks.length + needs.failed.length + needs.stuck.length + needs.flagged.length + (needs.unreadable ? 1 : 0);
}
/** The things that need the operator, per project and in total: what the verdict says and the badges show. */
function needCounts(status, includeSelftest = false) {
	const clock = {
		now: Date.parse(status.generatedAt),
		today: status.today,
		offset: status.utcOffset
	};
	const byProject = {};
	let total = 0;
	for (const project of status.projects) {
		const size = needsSize(projectNeeds(clock, status.generatedAt, project));
		byProject[project.name] = size;
		if (includeSelftest || !isSelftest(project.name)) total += size;
	}
	return {
		total,
		byProject
	};
}
function verdictTone(needs) {
	const kinds = new Set(needs.map((card) => card.kind));
	if (kinds.has("failed") || kinds.has("flagged") || kinds.has("unreadable")) return "bad";
	if (kinds.has("held") || kinds.has("asks")) return "wait";
	return kinds.has("stuck") ? "late" : "ok";
}
/** "Last ritual run 18 h ago, complete." The newest run of any ritual; nothing when no ritual is tracked. */
function lastRunPiece(clock, states) {
	if (states.length === 0) return [];
	const last = states.map((state) => state.last).filter((run) => run !== null).toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
	if (last === void 0) return [{
		text: " No ritual has run yet.",
		ink: "mute"
	}];
	const state = runState(last);
	return [{
		text: ` Last ritual run ${when(clock, last.startedAt)}, ${state.label.toLowerCase()}.`,
		ink: state.tone === "bad" ? "bad" : "plain"
	}];
}
/** The segment of one card kind: its count and a link to the first card. Nothing when there is no such card. */
function cardSegment(needs, kind, label, tone) {
	const cards = needs.filter((card) => card.kind === kind);
	const first = cards[0];
	return first === void 0 ? [] : [{
		key: kind,
		label,
		count: cards.length,
		tone,
		href: `#${first.id}`,
		live: false,
		kind: null
	}];
}
/**
* The status strip. A segment shows only above zero, and the strip not at all
* when every segment is zero. The order: need you (held runs and runs that
* ask), running (not the stuck ones), stuck, failed, flagged, unreadable, late
* (rituals and dated vigils past due), due today, and armed vigils.
*/
function statusStrip(needs, running, agenda, workspace) {
	const waiting = needs.filter((card) => card.kind === "held" || card.kind === "asks").length;
	const runningSegment = running === 0 ? [] : [{
		key: "running",
		label: "running",
		count: running,
		tone: "run",
		href: "#now",
		live: true,
		kind: null
	}];
	const needSegment = waiting === 0 ? [] : [{
		key: "need",
		label: "need you",
		count: waiting,
		tone: "wait",
		href: "#needs",
		live: false,
		kind: null
	}];
	const lateSegment = agenda.overdue === 0 ? [] : [{
		key: "late",
		label: "late",
		count: agenda.overdue,
		tone: "late",
		href: groupHref(agenda, "overdue", workspace),
		live: false,
		kind: null
	}];
	const todaySegment = agenda.dueToday === 0 ? [] : [{
		key: "today",
		label: "due today",
		count: agenda.dueToday,
		tone: "gold",
		href: groupHref(agenda, "today", workspace),
		live: false,
		kind: null
	}];
	const armedHref = `${sectionPath(workspace, "vigils")}#${agenda.waiting.length === 0 ? "coming-up" : "waiting"}`;
	const armedSegment = agenda.armed === 0 ? [] : [{
		key: "armed",
		label: "vigils armed",
		count: agenda.armed,
		tone: "gold",
		href: armedHref,
		live: false,
		kind: "vigil"
	}];
	return [
		...needSegment,
		...runningSegment,
		...cardSegment(needs, "stuck", "stuck", "late"),
		...cardSegment(needs, "failed", "failed", "bad"),
		...cardSegment(needs, "flagged", "flagged", "bad"),
		...cardSegment(needs, "unreadable", "unreadable", "bad"),
		...lateSegment,
		...todaySegment,
		...armedSegment
	];
}
/** Where a day group of the agenda lives: the Rituals section when it holds a ritual, else the Vigils section. */
function groupHref(agenda, kind, workspace) {
	return `${sectionPath(workspace, (agenda.groups.find((group) => group.kind === kind)?.rows ?? []).some((row) => row.kind === "ritual") ? "rituals" : "vigils")}#coming-up`;
}
function newest(left, right) {
	return right.startedAt.localeCompare(left.startedAt);
}
function nowRun(run) {
	return {
		id: run.run,
		title: run.label,
		project: run.project,
		href: runPath(run.project, run.run),
		startedAt: run.startedAt,
		who: run.who,
		kind: run.kind,
		manual: run.manual
	};
}
var ALL_WORKSPACES$1 = {
	workspace: null,
	includeSelftest: false
};
/** The projects an Overview covers. */
function scopeProjects(status, scope) {
	if (scope.workspace !== null) return status.projects.filter((project) => project.name === scope.workspace);
	return status.projects.filter((project) => scope.includeSelftest || !isSelftest(project.name));
}
function homeView(status, readRun, scope = ALL_WORKSPACES$1) {
	const clock = {
		now: Date.parse(status.generatedAt),
		today: status.today,
		offset: status.utcOffset
	};
	const all = scopeProjects(status, scope).map((project) => projectNeeds(clock, status.generatedAt, project));
	const states = all.flatMap((needs) => needs.states);
	const runs = all.flatMap((needs) => needs.runs).toSorted(newest);
	const needs = [
		...all.flatMap((entry) => entry.held).toSorted(newest).map((run) => heldCard(clock, run)),
		...all.flatMap((entry) => entry.asks).toSorted(newest).map((run) => asksCard(clock, readRun, run)),
		...all.flatMap((entry) => entry.failed).flatMap((state) => state.last === null ? [] : [finishedCard(clock, readRun, state, state.last)]),
		...all.flatMap((entry) => entry.stuck).toSorted((left, right) => newest(left.run, right.run)).map(({ run, size }) => stuckCard(clock, run, size)),
		...all.flatMap((entry) => entry.flagged.map((vigil) => flaggedCard(clock, entry.project, vigil, runs, status.generatedAt))),
		...all.filter((entry) => entry.unreadable).map((entry) => unreadableCard(entry.project))
	];
	const lastNight = states.filter((state) => state.last !== null && isDone(state.last) && clock.now - Date.parse(state.last.startedAt) < DAY).toSorted((left, right) => (right.last?.startedAt ?? "").localeCompare(left.last?.startedAt ?? "")).flatMap((state) => state.last === null ? [] : [finishedCard(clock, readRun, state, state.last)]);
	const agenda = buildAgenda({
		projects: all.map((entry) => entry.project),
		today: clock.today
	});
	const now = runs.filter((run) => run.phase === "running" && stuckFor(run, status.generatedAt) === null).map((run) => nowRun(run));
	return {
		verdict: verdictText(needs.length),
		tone: verdictTone(needs),
		sub: `${dayName(status.generatedAt, clock.offset)}, ${clockTime(status.generatedAt, clock.offset)}`,
		next: nextLine(agenda, clock.today),
		strip: statusStrip(needs, now.length, agenda, scope.workspace),
		now,
		needs,
		lastNight,
		agenda,
		health: [
			timerPiece(clock, status, states),
			syncPiece(clock, status),
			...lastRunPiece(clock, states)
		]
	};
}
/** "Self-test: heartbeat ran 12 h ago. 1 vigil flagged." for each self-test project on this host. */
function selftestLines(status) {
	const clock = {
		now: Date.parse(status.generatedAt),
		today: status.today,
		offset: status.utcOffset
	};
	return status.projects.filter((project) => isSelftest(project.name)).map((project) => {
		const href = workspacePath(project.name);
		if (project.error !== null) return {
			text: `Self-test: darius could not read ${project.name}.`,
			href
		};
		const last = project.runs.find((run) => run.who !== "import");
		const slug = last === void 0 ? null : last.item.split("/")[1] ?? last.item;
		const ran = (() => {
			if (last === void 0 || slug === null) return "no run yet.";
			if (last.phase === "closed" && last.outcome === "complete") return `${slug} ran ${whenPhrase(clock, last.startedAt)}.`;
			return `${slug} ${runState(last).label.toLowerCase()}, started ${whenPhrase(clock, last.startedAt)}.`;
		})();
		const flagged = project.vigils.filter((vigil) => vigil.flagged).length;
		return {
			text: `Self-test: ${ran} ${flagged === 0 ? "Nothing flagged." : `${plural$1(flagged, "vigil")} flagged.`}`,
			href
		};
	});
}
//#endregion
//#region app/lib/settings.ts
var SETTINGS_COOKIE = "darius-settings";
/** A year, in seconds: the cookie outlives a browser restart. */
var SETTINGS_MAX_AGE = 31536e3;
var DEFAULT_SETTINGS = {
	theme: "dark",
	density: "comfortable",
	defaultWorkspace: null,
	showSelftest: false,
	motion: "system"
};
var THEMES$1 = /* @__PURE__ */ new Set([
	"dark",
	"light",
	"system"
]);
var DENSITIES$1 = /* @__PURE__ */ new Set(["comfortable", "compact"]);
var MOTIONS$1 = /* @__PURE__ */ new Set(["system", "reduce"]);
/** The value of one cookie in a `Cookie` header, or null. */
function cookieValue(header, name) {
	if (header === null) return null;
	for (const part of header.split(";")) {
		const at = part.indexOf("=");
		if (at !== -1 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
	}
	return null;
}
/** One `key=value` pair of the cookie value, as a map. */
function pairs(value) {
	const found = /* @__PURE__ */ new Map();
	let text = value;
	try {
		text = decodeURIComponent(value);
	} catch {
		return found;
	}
	for (const part of text.split("&")) {
		const at = part.indexOf("=");
		if (at > 0) found.set(part.slice(0, at), part.slice(at + 1));
	}
	return found;
}
function pick(value, allowed, fallback) {
	return value !== void 0 && allowed.has(value) ? value : fallback;
}
/** The settings in a request's `Cookie` header; the defaults for anything missing or unknown. */
function readSettings(cookieHeader) {
	const raw = cookieValue(cookieHeader, SETTINGS_COOKIE);
	if (raw === null) return DEFAULT_SETTINGS;
	const found = pairs(raw);
	const workspace = found.get("ws") ?? "";
	return {
		theme: pick(found.get("theme"), THEMES$1, DEFAULT_SETTINGS.theme),
		density: pick(found.get("density"), DENSITIES$1, DEFAULT_SETTINGS.density),
		defaultWorkspace: /^[\w.-]{1,100}$/u.test(workspace) ? workspace : null,
		showSelftest: found.get("selftest") === "1",
		motion: pick(found.get("motion"), MOTIONS$1, DEFAULT_SETTINGS.motion)
	};
}
/** The cookie value for some settings: `readSettings` reads it back to the same settings. */
function settingsValue(settings) {
	const text = [
		`theme=${settings.theme}`,
		`density=${settings.density}`,
		`ws=${settings.defaultWorkspace ?? ""}`,
		`selftest=${settings.showSelftest ? "1" : "0"}`,
		`motion=${settings.motion}`
	].join("&");
	return encodeURIComponent(text);
}
//#endregion
//#region app/lib/scope.ts
/**
* Scope: which workspaces a page covers. A workspace is a darius project.
* The scope is one workspace (`/w/<ws>/...`) or all of them (`/vigils`,
* `/rituals`, `/milestones`, `/all`); `/` opens the operator's default
* workspace, or all of them. The all-workspaces scope leaves out the
* self-test workspace unless the operator shows it in the settings.
* Everything here is pure: loaders call it with the status and the settings,
* the shell calls it with the path.
*/
function tabCounts(projects, today) {
	const vigils = buildAgenda({
		projects,
		today,
		only: "vigil"
	});
	const rituals = buildAgenda({
		projects,
		today,
		only: "ritual"
	});
	return {
		vigils: vigils.overdue + vigils.dueToday,
		rituals: rituals.overdue
	};
}
/** The default workspace from the settings, when this host has it; otherwise null (all workspaces). */
function defaultWorkspaceOf(status, settings) {
	const name = settings.defaultWorkspace;
	return name !== null && status.projects.some((project) => project.name === name) ? name : null;
}
/**
* The scope of a request. A `ws` param names a workspace (404 when this host
* has none of that name). `/all` is all workspaces. `/` is the default
* workspace. Any other path without a `ws` param is all workspaces.
*/
function scopeOfRequest(status, request, workspace) {
	const settings = readSettings(request.headers.get("Cookie"));
	const includeSelftest = settings.showSelftest;
	if (workspace !== void 0) {
		if (!status.projects.some((project) => project.name === workspace)) throw data(`No workspace named ${workspace} on this host.`, { status: 404 });
		const scope = {
			workspace,
			includeSelftest
		};
		return {
			settings,
			scope,
			projects: scopeProjects(status, scope)
		};
	}
	const scope = {
		workspace: new URL(request.url).pathname === "/" ? defaultWorkspaceOf(status, settings) : null,
		includeSelftest
	};
	return {
		settings,
		scope,
		projects: scopeProjects(status, scope)
	};
}
/** The workspaces the switcher lists: the self-test one only when it is shown. */
function workspaceEntries(status, settings, needsBy) {
	return scopeProjects(status, {
		workspace: null,
		includeSelftest: settings.showSelftest
	}).map((project) => ({
		name: project.name,
		error: project.error !== null,
		needs: needsBy[project.name] ?? 0,
		tabs: tabCounts([project], status.today)
	}));
}
function isSection(text) {
	return text === "vigils" || text === "rituals" || text === "milestones";
}
function decoded$1(text) {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}
/**
* The place of a path, for the top bar and the tabs. `/` is the default
* workspace. A ritual page and the runs pages belong to Rituals. Settings and
* Profiles keep the default scope.
*/
function placeOf(pathname, search, defaultWorkspace) {
	const parts = pathname.split("/").filter((part) => part !== "");
	const [first, second, third] = parts;
	if (parts.length === 0) return {
		workspace: defaultWorkspace,
		section: null,
		overview: true
	};
	if (first === "all") return {
		workspace: null,
		section: null,
		overview: true
	};
	if (first === "w" && second !== void 0) {
		const workspace = decoded$1(second);
		return isSection(third) ? {
			workspace,
			section: third,
			overview: false
		} : {
			workspace,
			section: null,
			overview: third === void 0
		};
	}
	if (first === "p" && second !== void 0) return {
		workspace: decoded$1(second),
		section: third === "rituals" ? "rituals" : null,
		overview: false
	};
	if (isSection(first)) return {
		workspace: null,
		section: first,
		overview: false
	};
	if (first === "runs") return {
		workspace: parts.length === 1 ? new URLSearchParams(search).get("project") : decoded$1(second ?? ""),
		section: "rituals",
		overview: false
	};
	return {
		workspace: defaultWorkspace,
		section: null,
		overview: false
	};
}
function shellData(status, request) {
	const settings = readSettings(request.headers.get("Cookie"));
	const counts = needCounts(status, settings.showSelftest);
	return {
		needs: counts.total,
		selftest: settings.showSelftest ? [] : selftestLines(status),
		workspaces: workspaceEntries(status, settings, counts.byProject),
		allTabs: tabCounts(scopeProjects(status, {
			workspace: null,
			includeSelftest: settings.showSelftest
		}), status.today),
		defaultWorkspace: defaultWorkspaceOf(status, settings)
	};
}
//#endregion
//#region app/components/shell.tsx
/**
* The frame around every page. The top bar has four things: the brand gem
* (it opens the Overview of the scope you are in), the workspace switcher, the
* status pulse and the settings gear. The scope is one workspace or all of them. The switcher
* opens as a sheet under the bar on a phone and as a menu on a desktop; its
* first entry is the Overview of the current scope, then All workspaces, then
* each workspace with what needs you. The three sections of the scope, Vigils,
* Rituals and Milestones, are the tabs: at the bottom of a phone, under the
* bar on a desktop. One footer line holds the host facts.
*/
/** The tabs, in order. The badge of Vigils counts those due today or late, the badge of Rituals those late. */
var SECTIONS = [
	{
		section: "vigils",
		label: "Vigils",
		badge: (tabs) => ({
			count: tabs.vigils,
			tone: "wait",
			text: "due today or late"
		})
	},
	{
		section: "rituals",
		label: "Rituals",
		badge: (tabs) => ({
			count: tabs.rituals,
			tone: "late",
			text: "late"
		})
	},
	{
		section: "milestones",
		label: "Milestones",
		badge: () => ({
			count: 0,
			tone: "wait",
			text: ""
		})
	}
];
function SectionIcon({ section, size }) {
	if (section === "milestones") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavIcon, {
		name: "milestone",
		size,
		className: "tab-ico"
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindIcon, {
		kind: section === "vigils" ? "vigil" : "ritual",
		size,
		className: "tab-ico"
	});
}
/** The count on a tab: a small solid square with the number; screen readers hear what it counts. */
function TabBadge({ count, tone, text }) {
	if (count === 0) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
		className: `tab-bdg tone-${tone}`,
		title: `${count} ${text}`,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			"aria-hidden": "true",
			children: count
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "sr-only",
			children: `${count} ${text}`
		})]
	});
}
/** Closes open menus on a press outside them and on Escape; a link inside closes one by changing the path. */
function useMenuDismiss() {
	(0, import_react.useEffect)(() => {
		const close = (except) => {
			for (const menu of document.querySelectorAll("details[data-menu][open]")) if (except === null || !(except instanceof Node) || !menu.contains(except)) menu.open = false;
		};
		const onPress = (event) => close(event.target);
		const onKey = (event) => {
			if (event.key === "Escape") close(null);
		};
		document.addEventListener("pointerdown", onPress);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPress);
			document.removeEventListener("keydown", onKey);
		};
	}, []);
}
/** The scrim behind the switcher sheet: a press on it shuts the menu it sits in. */
function closeMenu(event) {
	const menu = event.currentTarget.closest("details");
	if (menu === null) return;
	menu.open = false;
	menu.querySelector("summary")?.focus();
}
function Entry({ href, name, icon, note, needs, unreadable = false, current }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
		to: href,
		className: current ? "sw-item on" : "sw-item",
		"aria-current": current ? "true" : void 0,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavIcon, {
				name: icon,
				size: 18,
				className: "sw-ico"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "sw-text",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "sw-name",
					children: name
				}), note === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "sw-note",
					children: note
				})]
			}),
			unreadable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "sw-need tone-bad",
				children: "unreadable"
			}) : needs > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "sw-need",
				children: `${needs} ${needs === 1 ? "needs" : "need"} you`
			}) : icon === "overview" ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "sw-clear",
				children: "all clear"
			}),
			current && icon !== "overview" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavIcon, {
				name: "check",
				size: 18,
				className: "sw-check"
			}) : null
		]
	});
}
/** The workspace switcher: a button with the current scope; its list is a sheet on a phone, a menu on a desktop. */
function Switcher({ data, place, overview, to, pathKey }) {
	const { workspace } = place;
	const known = data.workspaces.some((entry) => entry.name === workspace);
	const listed = workspace === null || known ? data.workspaces : [...data.workspaces, {
		name: workspace,
		error: false,
		needs: 0,
		tabs: {
			vigils: 0,
			rituals: 0
		}
	}];
	const others = workspace !== null && data.workspaces.some((entry) => entry.name !== workspace && entry.needs > 0);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
		"data-menu": true,
		className: "switcher",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", {
				className: "sw-btn",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "sw-lab",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "sw-cap",
							children: "Workspace"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "sw-now",
							children: workspace ?? "All workspaces"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavIcon, {
						name: "chevron",
						size: 16,
						className: "sw-chev"
					}),
					others ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {
						className: "sw-dot",
						"aria-hidden": "true"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "sr-only",
						children: "Another workspace needs you"
					})] }) : null
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "sw-scrim",
				tabIndex: -1,
				"aria-label": "Close the workspace list",
				onClick: closeMenu
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "sw-list",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "sw-group",
						children: workspace === null ? "All workspaces" : "This workspace"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Entry, {
						href: overview,
						name: "Overview",
						icon: "overview",
						note: "Verdict, next, what needs you",
						needs: 0,
						current: place.overview
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "sw-group",
						children: "Workspaces"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Entry, {
						href: to(null),
						name: "All workspaces",
						icon: "all",
						note: "Every workspace together",
						needs: data.needs,
						current: workspace === null
					}),
					listed.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Entry, {
						href: to(entry.name),
						name: entry.name,
						icon: "workspace",
						note: "",
						needs: entry.needs,
						unreadable: entry.error,
						current: workspace === entry.name
					}, entry.name))
				]
			})
		]
	}, pathKey);
}
function Shell({ data, children }) {
	useMenuDismiss();
	const location = useLocation();
	const place = placeOf(location.pathname, location.search, data.defaultWorkspace);
	const { workspace } = place;
	const tabs = workspace === null ? data.allTabs : data.workspaces.find((entry) => entry.name === workspace)?.tabs ?? {
		vigils: 0,
		rituals: 0
	};
	const allOverview = data.defaultWorkspace === null ? "/" : "/all";
	const overviewOf = (name) => name === null ? allOverview : workspacePath(name);
	const overview = overviewOf(workspace);
	const scopeTo = (name) => place.section === null ? overviewOf(name) : sectionPath(name, place.section);
	const selectedTab = (section) => place.section === section;
	const inSettings = location.pathname === "/settings" || location.pathname.startsWith("/settings/");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "app",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "bar",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "bar-in wa",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
							to: overview,
							className: "brand",
							"aria-label": "darius, the Overview",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Gem, { size: 28 }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "brand-word",
								children: "darius"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Switcher, {
							data,
							place,
							overview,
							to: scopeTo,
							pathKey: `${location.pathname}${location.search}`
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/status",
							className: location.pathname === "/status" ? "gear on" : "gear",
							"aria-label": "Status",
							"aria-current": location.pathname === "/status" ? "page" : void 0,
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavIcon, {
								name: "status",
								size: 22
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/settings",
							className: inSettings ? "gear on" : "gear",
							"aria-label": "Settings",
							"aria-current": inSettings ? "page" : void 0,
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavIcon, {
								name: "gear",
								size: 22
							})
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
					"aria-label": "Sections",
					className: "dtabs wa",
					children: SECTIONS.map(({ section, label, badge }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: sectionPath(workspace, section),
						className: selectedTab(section) ? "dt on" : "dt",
						"aria-current": selectedTab(section) ? "page" : void 0,
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionIcon, {
								section,
								size: 20
							}),
							label,
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabBadge, { ...badge(tabs) })
						]
					}, section))
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
				className: "wa page-main",
				children
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("footer", {
				className: "wa",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "foot",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "foot-left",
						children: place.overview && workspace === null ? data.selftest.map((line) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: line.href,
							className: "foot-selftest",
							children: line.text
						}, line.href)) : null
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "foot-host",
						children: [
							data.host,
							", darius ",
							data.version,
							", updated ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", {
								dateTime: data.generatedAt,
								children: clockTime(data.generatedAt, data.utcOffset)
							}),
							", seen by ",
							data.viewer,
							". ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: "/profiles",
								children: "Profiles"
							})
						]
					})]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
				"aria-label": "Tabs",
				className: "tabbar",
				children: SECTIONS.map(({ section, label, badge }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
					to: sectionPath(workspace, section),
					className: selectedTab(section) ? "tab on" : "tab",
					"aria-current": selectedTab(section) ? "page" : void 0,
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "tab-ico-wrap",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionIcon, {
							section,
							size: 22
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabBadge, { ...badge(tabs) })]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label })]
				}, section))
			})
		]
	});
}
//#endregion
//#region app/lib/clock.tsx
/**
* The page clock. The server and the first client render both use the
* status time from the root loader, so hydration sees the same text. After
* hydration the clock follows the browser and ticks every 30 seconds.
*/
var ClockContext = (0, import_react.createContext)({
	now: 0,
	today: "1970-01-01",
	offset: 0
});
function useClock() {
	return (0, import_react.useContext)(ClockContext);
}
var TICK_MS = 3e4;
function ClockProvider({ generatedAt, today, offset, children }) {
	const [browserNow, setBrowserNow] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		setBrowserNow(Date.now());
		const timer = setInterval(() => setBrowserNow(Date.now()), TICK_MS);
		return () => clearInterval(timer);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ClockContext, {
		value: {
			now: browserNow ?? Date.parse(generatedAt),
			today,
			offset
		},
		children
	});
}
//#endregion
//#region app/lib/status.ts
var cache = /* @__PURE__ */ new WeakMap();
function statusOf(context) {
	const cached = cache.get(context);
	if (cached !== void 0) return cached;
	const status = context.status();
	cache.set(context, status);
	return status;
}
//#endregion
//#region app/root.tsx
var root_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => ErrorBoundary,
	Layout: () => Layout,
	default: () => root_default,
	links: () => links,
	loader: () => loader$16,
	meta: () => meta$15,
	shouldRevalidate: () => shouldRevalidate
});
function loader$16({ context, request }) {
	const settings = readSettings(request.headers.get("cookie"));
	const status = statusOf(context);
	return {
		nonce: context.nonce,
		settings,
		viewer: context.viewer,
		host: status.host,
		version: status.version,
		generatedAt: status.generatedAt,
		today: status.today,
		utcOffset: status.utcOffset,
		...shellData(status, request)
	};
}
function shouldRevalidate() {
	return true;
}
var meta$15 = () => [{ title: "darius" }];
var links = () => [
	{
		rel: "icon",
		href: "/favicon.svg",
		type: "image/svg+xml"
	},
	{
		rel: "manifest",
		href: "/manifest.webmanifest"
	},
	{
		rel: "apple-touch-icon",
		href: "/apple-touch-icon.png"
	}
];
var COLOR_SCHEMES = {
	dark: "dark",
	light: "light",
	system: "dark light"
};
var NIGHT = "#15100b";
var PAPYRUS = "#f0e6c9";
function ThemeColor({ theme }) {
	if (theme === "dark") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meta", {
		name: "theme-color",
		content: NIGHT
	});
	if (theme === "light") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meta", {
		name: "theme-color",
		content: PAPYRUS
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meta", {
		name: "theme-color",
		content: PAPYRUS,
		media: "(prefers-color-scheme: light)"
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meta", {
		name: "theme-color",
		content: NIGHT,
		media: "(prefers-color-scheme: dark)"
	})] });
}
function Layout({ children }) {
	const data = useRouteLoaderData("root");
	const [nonce] = (0, import_react.useState)((0, import_react.useContext)(NonceContext) ?? data?.nonce);
	const settings = data?.settings ?? DEFAULT_SETTINGS;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "en",
		"data-theme": settings.theme,
		"data-density": settings.density,
		"data-motion": settings.motion,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("head", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meta", { charSet: "utf-8" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meta", {
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meta", {
				name: "color-scheme",
				content: COLOR_SCHEMES[settings.theme]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ThemeColor, { theme: settings.theme }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meta", {
				name: "apple-mobile-web-app-capable",
				content: "yes"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meta", {
				name: "apple-mobile-web-app-status-bar-style",
				content: "black-translucent"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meta", {
				name: "apple-mobile-web-app-title",
				content: "darius"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meta, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Links, { nonce })
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", { children: [
			children,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScrollRestoration, { nonce }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, { nonce })
		] })]
	});
}
var REFRESH_MS = 6e4;
/** Reload the data every minute while the tab is visible, and on return to a stale tab. */
function useRefresh(generatedAt) {
	const { revalidate } = useRevalidator();
	(0, import_react.useEffect)(() => {
		const stale = () => Date.now() - Date.parse(generatedAt) >= REFRESH_MS;
		const refresh = () => {
			if (document.visibilityState === "visible" && stale()) revalidate();
		};
		const timer = setInterval(refresh, REFRESH_MS / 4);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, [generatedAt, revalidate]);
}
var root_default = withComponentProps(function App({ loaderData }) {
	useRefresh(loaderData.generatedAt);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ClockProvider, {
		generatedAt: loaderData.generatedAt,
		today: loaderData.today,
		offset: loaderData.utcOffset,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Shell, {
			data: loaderData,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {})
		})
	});
});
/** The last resort, when even the top bar data failed. Pages have their own boundary. */
var ErrorBoundary = withErrorBoundaryProps(function ErrorBoundary({ error }) {
	const data = useRouteLoaderData("root");
	const title = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : "darius could not show this page";
	const detail = isRouteErrorResponse(error) ? String(error.data ?? "") : error instanceof Error ? error.message : "";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "wa page-main reading stack",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "brand",
				children: "darius"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "page-title ink-bad",
				children: title
			}),
			detail === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
				className: "code-block",
				children: detail
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-muted",
				children: data === void 0 ? "The status read failed." : `Host ${data.host}.`
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/",
				children: "Back home"
			})
		]
	});
});
//#endregion
//#region app/components/chip.tsx
/**
* The one chip: a small square-cornered box with a tinted border and ground,
* a sentence-case word and an optional icon. It is used for result counts and
* "imported", in a state tone. A kind is not a chip: it is a coloured word
* (`KindWord`), because the row's icon already carries the kind colour and a
* second box would say the same thing twice.
*/
/** A chip. `color` picks the tint; `glyph` adds a 12 px icon with a 4 px gap. */
function Chip({ color, glyph, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
		className: `chip-x c-${color}`,
		children: [glyph === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindIcon, {
			kind: glyph,
			size: 12
		}), children]
	});
}
/** What an item is, as one coloured word: "ritual", "manual ritual" or "vigil". */
function KindWord({ kind, manual = false, icon = false }) {
	const glyph = kind === "ritual" && manual ? "manual" : kind;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
		className: `kind-word c-${glyph}`,
		children: [icon ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindIcon, {
			kind: glyph,
			size: 14
		}) : null, glyph === "manual" ? "manual ritual" : kindWord(kind)]
	});
}
//#endregion
//#region app/components/command.tsx
/**
* A command in a box with a Copy button. `navigator.clipboard` exists only
* in a secure context, and the page is plain http on the tailnet, so the
* fallback selects the text for a manual copy. The box selects all on one
* tap even without JavaScript.
*/
/**
* The command as text, with each hyphenated word (a project name, say) kept
* whole: a narrow box then wraps at the spaces, never inside "demo-shop".
* The copied text is the plain command.
*/
function wrapSafe(command) {
	return command.split(/(\S*\w-\w\S*)/u).map((part, index) => index % 2 === 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "nowrap",
		children: part
	}, `${index}`) : part);
}
function Command({ command }) {
	const box = (0, import_react.useRef)(null);
	const [result, setResult] = (0, import_react.useState)("none");
	function selectBox() {
		const element = box.current;
		const selection = window.getSelection();
		if (element === null || selection === null) return;
		selection.selectAllChildren(element);
	}
	async function copy() {
		if (window.isSecureContext && "clipboard" in navigator) try {
			await navigator.clipboard.writeText(command);
			setResult("copied");
			return;
		} catch {}
		selectBox();
		setResult("selected");
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "cmd-wrap",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "cmd",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
				ref: box,
				className: "cmd-text",
				children: wrapSafe(command)
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "copy",
				onClick: () => void copy(),
				children: result === "copied" ? "Copied" : "Copy"
			})]
		}), result === "selected" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "cmd-note",
			children: "This page cannot reach the clipboard. The command is selected: copy it now."
		}) : null]
	});
}
//#endregion
//#region app/components/markdown.tsx
function Line({ line }) {
	return line.map((span, index) => {
		const key = `${index}`;
		if (span.kind === "code") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
			className: "inline-code",
			children: span.text
		}, key);
		if (span.kind === "bold") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", {
			className: "font-semibold text-parchment",
			children: span.text
		}, key);
		if (span.kind === "italic") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: span.text }, key);
		return span.text;
	});
}
/** Markdown levels 1 to 6 sit below the page title and the panel heading. */
function Heading({ level, content }) {
	const body = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Line, { line: content });
	if (level <= 1) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
		className: "md-h1",
		children: body
	});
	if (level === 2) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", {
		className: "md-h2",
		children: body
	});
	if (level === 3) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h5", {
		className: "md-h3",
		children: body
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h6", {
		className: "md-h4",
		children: body
	});
}
var CHECK_WORDS = {
	done: "Done",
	open: "Open",
	doing: "In progress",
	blocked: "Blocked",
	skipped: "Skipped"
};
/** A checklist box: a tick when done, a dash when skipped, a bar when blocked, a dot when in progress, empty when open. */
function Box({ check }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		className: `md-box md-box-${check}`,
		width: "14",
		height: "14",
		viewBox: "0 0 14 14",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		role: "img",
		"aria-label": CHECK_WORDS[check],
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
				x: "1.25",
				y: "1.25",
				width: "11.5",
				height: "11.5"
			}),
			check === "done" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3.8 7.2L6 9.4L10.2 4.8" }) : null,
			check === "skipped" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.2 7H9.8" }) : null,
			check === "blocked" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M7 3.8V7.6M7 9.9V10" }) : null,
			check === "doing" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
				cx: "7",
				cy: "7",
				r: "1.6",
				fill: "currentColor",
				stroke: "none"
			}) : null
		]
	});
}
function List({ block }) {
	const { checks, nested } = block;
	const items = block.items.map((item, index) => {
		const check = checks?.[index] ?? null;
		const classes = [check === null ? null : "md-check", nested?.[index] === true ? "md-nested" : null].filter((name) => name !== null);
		return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
			className: classes.length === 0 ? void 0 : classes.join(" "),
			children: check === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Line, { line: item }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Box, { check }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Line, { line: item }) })] })
		}, `${index}`);
	});
	const className = checks === void 0 ? void 0 : "md-checks";
	return block.ordered ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
		start: block.start,
		className,
		children: items
	}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
		className,
		children: items
	});
}
function Block({ block }) {
	switch (block.kind) {
		case "heading": return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Heading, {
			level: block.level,
			content: block.content
		});
		case "paragraph": return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: block.lines.map((line, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [index > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Line, { line })] }, `${index}`)) });
		case "list": return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(List, { block });
		case "table": return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "table-scroll",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "grid-table",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: block.head.map((cell, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
					scope: "col",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Line, { line: cell })
				}, `${index}`)) }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: block.rows.map((row, rowIndex) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: row.map((cell, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Line, { line: cell }) }, `${index}`)) }, `${rowIndex}`)) })]
			})
		});
		case "code": return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
			className: "code-block",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: block.text })
		});
	}
}
function Markdown({ blocks }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "md",
		children: blocks.map((block, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Block, { block }, `${index}`))
	});
}
//#endregion
//#region app/lib/result.ts
function resultTone(status) {
	if (status === "ok") return "ok";
	return status === "attention" ? "wait" : "bad";
}
function resultWord(status) {
	if (status === "ok") return "Result ok";
	return status === "attention" ? "Needs attention" : "Result failed";
}
var SEVERITY_RANK = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4
};
var STATE_RANK = {
	open: 0,
	"needs-decision": 1,
	"not-verified": 2,
	fixed: 3
};
function severityTone(severity) {
	if (severity === "critical") return "bad";
	if (severity === "high") return "late";
	if (severity === "medium") return "gold";
	return severity === "low" ? "idle" : null;
}
function itemStateTag(state) {
	if (state === "fixed") return {
		text: "fixed",
		tone: "ok"
	};
	if (state === "needs-decision") return {
		text: "needs decision",
		tone: "wait"
	};
	if (state === "not-verified") return {
		text: "not verified",
		tone: "late"
	};
	return {
		text: "open",
		tone: null
	};
}
function actionTag(state) {
	if (state === "done") return {
		text: "done",
		tone: "ok"
	};
	return state === "failed" ? {
		text: "failed",
		tone: "bad"
	} : {
		text: "skipped",
		tone: "idle"
	};
}
function metricTag(tone) {
	if (tone === "ok") return {
		tone: "ok",
		word: "ok"
	};
	return tone === "warn" ? {
		tone: "late",
		word: "warning"
	} : {
		tone: "bad",
		word: "bad"
	};
}
/** Critical first, then by state: open, needs decision, not verified, fixed. Ties keep the model's order. */
function byWeight(left, right) {
	return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || STATE_RANK[left.state] - STATE_RANK[right.state];
}
/** The items by group, in the order the groups first appear; the items without a group last, in one group. */
function groupItems(items) {
	const named = /* @__PURE__ */ new Map();
	const loose = [];
	for (const item of items) {
		if (item.group === void 0) {
			loose.push(item);
			continue;
		}
		const list = named.get(item.group);
		if (list === void 0) named.set(item.group, [item]);
		else list.push(item);
	}
	const groups = [...named].map(([name, list]) => ({
		name,
		items: list.toSorted(byWeight)
	}));
	if (loose.length > 0) groups.push({
		name: null,
		items: loose.toSorted(byWeight)
	});
	return groups;
}
/** "3 open, 2 fixed", over the items of a result. */
function itemsText(items) {
	const fixed = items.filter((item) => item.state === "fixed").length;
	const open = items.length - fixed;
	return [open === 0 ? null : `${open} open`, fixed === 0 ? null : `${fixed} fixed`].filter((part) => part !== null).join(", ");
}
function plural(count, noun) {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
/**
* The tags a run row shows for its result: open critical and high items,
* and the questions, in the waiting tone until someone answered them.
*/
function summaryTags(summary, isAnswered) {
	const tags = [];
	if (summary.open.critical > 0) tags.push({
		text: `${summary.open.critical} critical open`,
		tone: "bad"
	});
	if (summary.open.high > 0) tags.push({
		text: `${summary.open.high} high open`,
		tone: "late"
	});
	if (summary.questions > 0) {
		const text = plural(summary.questions, "question");
		tags.push(isAnswered ? {
			text: `${text}, answered`,
			tone: null
		} : {
			text,
			tone: "wait"
		});
	}
	return tags;
}
//#endregion
//#region app/components/ui.tsx
/** Small shared pieces: sections, status words, times, folds, code chips. */
/** A title in which a date such as 2026-09-30 never breaks at its hyphens. */
function TitleText({ text }) {
	return text.split(/(\d{4}-\d{2}-\d{2})/u).map((part, index) => /^\d{4}-\d{2}-\d{2}$/u.test(part) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "whitespace-nowrap",
		children: part
	}, `${index}`) : part);
}
/** A state in words, in the state colour: sans, 13 px, weight 600, sentence case (no square; the square stays in the status strip). */
function Status({ tone, label }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: `status tone-${tone}`,
		children: label
	});
}
/** A relative time with the absolute ISO time on hover. */
function Time({ iso }) {
	const { now } = useClock();
	if (iso === null) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "text-muted",
		children: "never"
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", {
		dateTime: iso,
		title: iso,
		children: relativeTime(iso, now)
	});
}
/** A section label between two rules that end in the small square tick of a D2 panel. */
function SectHead({ title, aside }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "sect",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "sect-rule sect-rule-start",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "label",
				children: title
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "sect-rule",
				"aria-hidden": "true"
			}),
			aside === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "sect-aside",
				children: aside
			})
		]
	});
}
/** A titled part of a page: the section label, then its content. */
function Section({ title, id, aside, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		id,
		className: "section",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectHead, {
			title,
			aside
		}), children]
	});
}
/** Detail that most visits do not need, closed until asked for. */
function Fold({ summary, id, open = false, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
		id,
		className: "fold scroll-mt-20",
		open,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: summary }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "fold-body",
			children
		})]
	});
}
function Empty({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "empty",
		children
	});
}
function Chips({ items, none }) {
	if (items.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "text-muted",
		children: none
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "flex flex-wrap gap-1.5",
		children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
			className: "chip",
			children: item
		}, item))
	});
}
function Facts({ facts }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", {
		className: "facts",
		children: facts.map((fact) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "contents",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: fact.label }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: fact.value })]
		}, fact.label))
	});
}
/** The path back up, above a page title. */
function Crumbs({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "crumbs",
		children
	});
}
//#endregion
//#region app/components/result.tsx
/** A small word in a chip, in its tone. The word carries the meaning; the colour only repeats it. */
function Tag({ tag }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
		color: tag.tone ?? "idle",
		children: tag.text
	});
}
/** The chips of a run row: open critical and high items, and the questions. */
function ResultChips({ summary, isAnswered }) {
	return summaryTags(summary, isAnswered).map((tag) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { tag }, tag.text));
}
/** The questions of a result, numbered, each with its recommendation. */
function QuestionList({ questions }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
		className: "qs",
		children: questions.map((question, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: question.text }), question.recommendation === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "rec",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "rec-label",
					children: "Recommended:"
				}),
				" ",
				question.recommendation
			]
		})] }, `${index}`))
	});
}
/**
* The "Questions for you" card. A complete run waits for the operator's
* decision: the card gives the command that records it. Once someone
* acknowledged the run, the card says who, when, and what they decided.
*/
function ResultQuestions({ project, row, questions }) {
	const clock = useClock();
	const seen = row.acknowledged;
	const isWaiting = seen === null && row.phase === "closed" && row.outcome === "complete";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: `card card-accent next ${isWaiting ? "edge-wait" : "edge-idle"}`,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(QuestionList, { questions }),
			seen === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: decisionText(seen, clock) }),
			isWaiting ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "next-cmd",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Record your decision:" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Command, { command: decideCommand(row.run, project) })]
			}) : null
		]
	});
}
function Tiles({ metrics }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", {
		className: "tiles",
		children: metrics.map((metric, index) => {
			const tone = metric.tone === void 0 ? null : metricTag(metric.tone);
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: tone === null ? "tile" : `tile tone-${tone.tone}`,
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
						className: "tile-l",
						children: metric.label
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", {
						className: "tile-v",
						children: [String(metric.value), metric.unit === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "tile-u",
							children: metric.unit
						})]
					}),
					tone === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
						className: "tile-t",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Status, {
							tone: tone.tone,
							label: tone.word
						})
					})
				]
			}, `${index}`);
		})
	});
}
function ItemRow({ item }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: item.state === "fixed" ? "ritem ritem-done" : "ritem",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "ritem-sev",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { tag: {
					text: item.severity,
					tone: severityTone(item.severity)
				} })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "ritem-main",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "ritem-title",
						children: item.title
					}),
					item.target === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "ritem-sub",
						children: item.target
					}),
					item.detail === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Fold, {
						summary: "Detail",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "ritem-detail",
							children: item.detail
						})
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "ritem-state",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { tag: itemStateTag(item.state) })
			})
		]
	});
}
/** The items by group, the worst first in each; the items without a group last. */
function Items({ items }) {
	const groups = groupItems(items);
	const isNamed = groups.some((group) => group.name !== null);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "rgroups",
		children: groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "rgroup",
			children: [isNamed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "rgroup-h",
				children: group.name ?? "Other items"
			}) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "rows",
				children: group.items.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ItemRow, { item }, `${index}`))
			})]
		}, group.name === null ? "loose" : `group-${group.name}`))
	});
}
function Actions({ actions }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
		className: "rows",
		children: actions.map((action, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
			className: "ritem ritem-act",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "ritem-main",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "ritem-title",
					children: action.text
				}), action.target === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "ritem-sub",
					children: action.target
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "ritem-state",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { tag: actionTag(action.state) })
			})]
		}, `${index}`))
	});
}
/** The top of a run page that handed in a result: the banner, the questions, the metric tiles, the items, the actions. A result that asks puts its questions before the tiles, so the decision is the first thing after the banner. */
function ResultPanel({ project, row, result }) {
	const tone = resultTone(result.status);
	const hasQuestions = result.questions.length > 0;
	const tiles = result.metrics.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tiles, { metrics: result.metrics });
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, {
			title: "Result",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: `card card-accent result-banner edge-${tone}`,
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Status, {
						tone,
						label: resultWord(result.status)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "result-summary",
						children: result.summary
					}),
					result.handoff === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "rail-note",
						children: ["Note for the next run: ", result.handoff]
					})
				]
			}), hasQuestions ? null : tiles]
		}),
		hasQuestions ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
			title: "Questions for you",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResultQuestions, {
				project,
				row,
				questions: result.questions
			})
		}), tiles === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
			title: "Numbers",
			children: tiles
		})] }) : null,
		result.items.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
			title: "What it found",
			aside: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-muted",
				children: itemsText(result.items)
			}),
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Items, { items: result.items })
		}),
		result.actions.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
			title: "What it changed",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Actions, { actions: result.actions })
		})
	] });
}
//#endregion
//#region app/components/row.tsx
/**
* The one row. Coming up, Waiting on an event, Now, Recent runs, /runs, a
* ritual's history, Latest reports, Last night and closed vigils all draw it,
* so the same thing looks the same on every page.
*
*     [icon]  Title in full, sans 15px, wraps
*             chip chip · State word · meta, meta · 4 h ago
*
* The icon is the kind's. The title is the stretched link: the whole row is
* the tap target. The state word, the chips and the time all sit on the second
* line, so a row never has a lone right-aligned word. A left rail marks only
* the rows that need attention: late, running, waiting for you, asks you,
* failed, flagged.
*/
/** A state word: sans, 13 px, weight 600, sentence case, in its tone. */
function StateWord({ state }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: `rw-state tone-${state.tone}`,
		children: state.label
	});
}
/** One row of a list; put it in a `RowList`. */
function Row({ id, kind, manual = false, title, href, rail = null, live = false, chips, state = null, meta = [], time, acts, detail, note, excerpt, className }) {
	const classes = [
		"rw",
		rail === null ? "" : `rw-rail tone-${rail}`,
		live ? "rw-live" : "",
		className ?? ""
	].filter((part) => part !== "");
	const segments = [];
	if (chips !== void 0 && chips !== null) segments.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "rw-seg rw-chips",
		children: chips
	}, "chips"));
	if (state !== null) segments.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "rw-seg",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StateWord, { state })
	}, "state"));
	const pieces = [...meta, ...time === void 0 || time === null ? [] : [time]];
	if (pieces.length > 0) segments.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "rw-seg rw-meta",
		children: pieces.map((piece, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.Fragment, { children: [index === 0 ? null : " ", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "rw-bit",
			children: [piece, index === pieces.length - 1 ? "" : ","]
		})] }, `${index}`))
	}, "meta"));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		id,
		className: classes.join(" "),
		children: [
			live ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "live-bar",
				"aria-hidden": "true"
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindIcon, {
				kind: kind === "ritual" && manual ? "manual" : kind,
				className: "rw-icon"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rw-main",
				children: [
					href === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "rw-title",
						children: title
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: href,
						className: "rw-title",
						children: title
					}),
					segments.length === 0 && acts === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "rw-line",
						children: [segments, acts === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "rw-acts",
							children: acts
						})]
					}),
					detail === void 0 || detail === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "rw-detail",
						children: detail
					}),
					note === void 0 || note === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "rw-note",
						children: note
					}),
					excerpt === void 0 || excerpt === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "rw-excerpt",
						children: excerpt
					})
				]
			})
		]
	});
}
/** A list of rows in one frame, separated by 1 px lines. */
function RowList({ children, bare = false, className }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
		className: `rw-list${bare ? " rw-bare" : ""}${className === void 0 ? "" : ` ${className}`}`,
		children
	});
}
//#endregion
//#region app/components/pulse.tsx
/** The head of a project page: the status strip, and the panel for what is open now. */
/** One count of the status strip. The whole segment is the link. */
function Pill({ label, value, tone, href, live = false, kind = null }) {
	const on = value > 0;
	const className = `pill tone-${on ? tone : "idle"}`;
	const body = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		on && live ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "live-bar",
			"aria-hidden": "true"
		}) : null,
		kind === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "pill-dot",
			"aria-hidden": "true"
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindIcon, {
			kind,
			size: 14,
			className: `pill-kind${on ? "" : " is-off"}`
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "pill-n",
			children: value
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "pill-l",
			children: label
		})
	] });
	if (href === null) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className,
		children: body
	});
	if (href.startsWith("#")) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
		href,
		className,
		children: body
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
		to: href,
		className,
		children: body
	});
}
/**
* A list that is short on a phone: rows marked `phone-extra` stay hidden until
* the button under them is pressed. On a wide screen every row shows and the button does not.
*/
function PhoneMore({ hidden, noun, open = false, children }) {
	const [expanded, setExpanded] = (0, import_react.useState)(open);
	(0, import_react.useEffect)(() => {
		if (open) setExpanded(true);
	}, [open]);
	if (hidden <= 0) return children;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: `phone-more${expanded ? " is-open" : ""}`,
		children: [children, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			className: "phone-toggle",
			"aria-expanded": expanded,
			onClick: () => setExpanded(!expanded),
			children: expanded ? "Show fewer" : `Show ${hidden} more ${noun}${hidden === 1 ? "" : "s"}`
		})]
	});
}
/** How long a run has run, against the page clock (it ticks every 30 s). */
function Elapsed({ since }) {
	const { now } = useClock();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: duration(since, new Date(now).toISOString()) || "just now" });
}
//#endregion
//#region app/components/board.tsx
/** The pieces of the command board: the Next line, the status strip, the Now rows, the Needs you card and the Last night rows. */
/** Text in parts, each part in its own colour. */
function Pieces({ pieces }) {
	return pieces.map((piece, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: piece.ink === "plain" ? void 0 : `ink-${piece.ink}`,
		children: piece.text
	}, `${index}`));
}
/** A paragraph as one flowing line: an excerpt drops the line breaks of its source. */
function flowing(block) {
	if (block.kind !== "paragraph") return block;
	return {
		kind: "paragraph",
		lines: [block.lines.flatMap((spans, index) => index === 0 ? spans : [{
			kind: "text",
			text: " "
		}, ...spans])]
	};
}
/** The first heading of a report in bold, then the start of its first paragraph. */
function Report({ report, lines, fades }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rep",
		children: [report.headline === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "rep-h",
			children: report.headline
		}), report.blocks.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: `rep-p clamp-${lines}${fades ? " fades" : ""}`,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Markdown, { blocks: report.blocks.map((block) => flowing(block)) })
		})]
	});
}
/** The status strip: the `Pill` segments of the project page, over all projects. Each segment is a link to what it counts. */
function StatusStrip$1({ segments }) {
	if (segments.length === 0) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
		className: "pulse pulse-home",
		"aria-label": "Summary",
		children: segments.map((segment) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, {
			label: segment.label,
			value: segment.count,
			tone: segment.tone,
			href: segment.href,
			live: segment.live,
			kind: segment.kind
		}, segment.key))
	});
}
/** One row per run that runs now, with its project, how long it has run and the sweeping light. */
function NowList({ runs }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RowList, { children: runs.map((run) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
		kind: run.kind,
		manual: run.manual,
		href: run.href,
		title: run.title,
		rail: "run",
		live: true,
		chips: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindWord, {
			kind: run.kind,
			manual: run.manual
		}),
		state: RUNNING,
		meta: [run.project, run.who === "timer" ? "by timer" : `by ${run.who}`],
		time: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: ["for ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Elapsed, { since: run.startedAt })] })
	}, run.id)) });
}
/** "Next ⟳ Daily site report · tomorrow": one link under the verdict to the first item that is not late. */
function NextUp({ next }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
		to: next.href,
		className: "nextup",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "nextup-l",
				children: "Next"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindIcon, {
				kind: next.kind,
				className: "nextup-icon"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "nextup-t",
				children: next.title
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: next.isToday ? "nextup-w is-today" : "nextup-w",
				children: next.when
			})
		]
	});
}
/** The Last night rows: what finished, as rows. The row opens the report; a desktop shows an excerpt under it. */
function DoneRows({ cards }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RowList, { children: cards.map((card) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
		id: card.id,
		kind: card.item ?? "ritual",
		manual: card.manual,
		href: card.href,
		title: card.title,
		chips: card.item === null ? void 0 : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindWord, {
			kind: card.item,
			manual: card.manual
		}),
		state: card.word.ink === "plain" || card.word.ink === "mute" ? null : {
			tone: card.word.ink,
			label: card.word.text
		},
		meta: card.meta,
		time: card.side === null ? void 0 : card.side.text,
		acts: card.actions[0] === void 0 ? void 0 : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
			to: card.actions[0].href,
			children: card.actions[0].text
		}),
		note: card.meta2,
		excerpt: card.report === null ? void 0 : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Report, {
			report: card.report,
			lines: 2,
			fades: false
		})
	}, card.id)) });
}
/** The commands of a card, closed under one line: a phone reads the question first and types the answer at a terminal. */
function Commands({ card }) {
	if (card.ask !== null) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Fold, {
		summary: "Answer from a terminal",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "hc-cmd-label",
			children: "Record your decision:"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Command, { command: card.ask.command })]
	});
	if (card.questions.length === 0) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Fold, {
		summary: "Answer from a terminal",
		children: card.questions.map((question, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "hc-cmd",
			children: [card.questions.length === 1 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "hc-cmd-label",
				children: ["Question ", index + 1]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Command, { command: question.command })]
		}, `${index}`))
	});
}
/**
* A Needs you card, or a plain Last night card when it has no edge. The head
* (the status word, the age, the title and the meta line) is one tap target
* to the run; the questions stay plain text and the commands wait in a
* closed disclosure.
*/
function CardView({ card }) {
	const edge = card.edge === null ? "card-plain" : `card-accent edge-${card.edge}`;
	const hasBody = card.questions.length > 0 || card.ask !== null || card.report !== null || card.error !== null || card.kind === "held";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
		id: card.id,
		className: `card hcard ${edge}`,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "hc-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "hc-main",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", {
							className: card.item === null ? "card-title" : "card-title has-kind-flex",
							children: [card.item === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindIcon, {
								kind: card.item,
								titled: true
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: card.href,
								children: card.title
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "card-meta rw-line",
							children: [card.item === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "rw-seg rw-chips",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindWord, {
									kind: card.item,
									manual: card.manual
								})
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "rw-seg rw-meta",
								children: card.meta.join(", ")
							})]
						}),
						card.meta2 === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "card-meta",
							children: card.meta2
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "hc-side",
					children: [card.word.ink === "plain" || card.word.ink === "mute" ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Status, {
						tone: card.word.ink,
						label: card.word.text
					}), card.side === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: `card-when${card.side.ink === "plain" ? "" : ` ink-${card.side.ink}`}`,
						children: card.side.text
					})]
				})]
			}),
			hasBody ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "hc-body",
				children: [
					card.kind === "held" && card.questions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "empty",
						children: "The run is held without a question. Resume or close it from the command line."
					}) : null,
					card.questions.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
						className: "qs",
						children: card.questions.map((question, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: question.text }) }, `${index}`))
					}),
					card.ask === null ? null : card.ask.questions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "empty",
						children: "Open the run to read its questions."
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(QuestionList, { questions: card.ask.questions }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Commands, { card }),
					card.report === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Report, {
						report: card.report,
						lines: card.edge === null ? 3 : 4,
						fades: card.fades
					}),
					card.error === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
						className: "code-block",
						children: card.error
					})
				]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "hc-acts",
				children: card.actions.map((action) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: action.href,
					children: action.text
				}, action.text))
			})
		]
	});
}
//#endregion
//#region app/components/runs.tsx
/** The run list, the held-question block and the latest-report row, shared by several pages. */
/** Runs as rows: what ran, how it ended, how long it took, who started it, when. Each row opens the run. */
function RunList({ runs, showProject, showLabel = true, empty, phoneShown = runs.length }) {
	const { offset } = useClock();
	if (runs.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: empty });
	const named = showProject && new Set(runs.map((run) => run.project)).size > 1;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RowList, {
		bare: true,
		children: runs.map((run, index) => {
			const state = runState(run);
			const took = run.endedAt === null ? null : duration(run.startedAt, run.endedAt);
			const isImport = run.who === "import";
			const meta = [
				named ? run.project : null,
				took === null ? null : `took ${took}`,
				isImport ? null : run.who === "timer" ? "by timer" : `by ${run.who}`
			].filter((part) => part !== null);
			const counts = run.result === null ? [] : summaryTags(run.result, run.acknowledged !== null);
			const chips = showLabel || counts.length > 0 || isImport ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
				showLabel ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindWord, {
					kind: run.kind,
					manual: run.manual
				}) : null,
				run.result === null || counts.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResultChips, {
					summary: run.result,
					isAnswered: run.acknowledged !== null
				}),
				isImport ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
					color: "idle",
					children: "imported"
				}) : null
			] }) : void 0;
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
				kind: run.kind,
				manual: run.manual,
				href: runPath(run.project, run.run),
				title: showLabel ? run.label : shortDate(hostDate(run.startedAt, offset)),
				rail: railOf(state),
				live: run.phase === "running",
				chips,
				state,
				meta,
				time: showLabel ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Time, { iso: run.startedAt }) : clockTime(run.startedAt, offset),
				className: index >= phoneShown ? "phone-extra" : void 0
			}, `${run.project}/${run.run}`);
		})
	});
}
/** The questions of a held run, each with the command that answers it. */
function Questions({ project, run }) {
	if (run.questions.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "The run is held without a question. Resume or close it from the command line." });
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
		className: "qs",
		children: run.questions.map((question, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: question }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Command, { command: answerCommand(run.run, index + 1, project) })] }, `${index}`))
	});
}
/**
* What happens after a failed or abandoned run: darius does not retry it
* today, so the card gives the two commands a person has. Once someone
* acknowledged the run, it says who, and when.
*/
function NextStepCard({ step }) {
	if (step.kind === "seen") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "card next",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: step.text })
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: `card card-accent edge-${step.tone} next`,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: step.text }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "next-cmd",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Run it now:" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Command, { command: step.runNow })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "next-cmd",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Seen it:" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Command, { command: step.ack })]
			})
		]
	});
}
/** Who acknowledged a run: the decision on a result's questions, or who saw a failure. */
function seenText(run, seen, clock) {
	return (run?.result?.questions ?? 0) > 0 ? decisionText(seen, clock) : ackText(seen, clock);
}
/**
* A ritual darius runs, as a row: its state, when it last ran, when it runs
* next, and its latest report. The row opens the latest run; "History" opens
* the ritual. A desktop shows a three-line excerpt of the report under it.
*/
function ReportRow({ project, ritual, last, report, showProject, className }) {
	const { today, offset } = useClock();
	const state = last === null ? {
		tone: "idle",
		label: "No run yet"
	} : runState(last);
	const seen = last?.acknowledged ?? null;
	const next = ritual.nextDue === null || ritual.overdueDays > 0 || ritual.heldRun !== null || ritual.openRun !== null ? null : `next ${datePhrase(today, ritual.nextDue)}`;
	const time = last === null && next === null ? void 0 : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		last === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Time, { iso: last.startedAt }),
		last === null || next === null ? null : ", ",
		next
	] });
	const result = last?.result ?? null;
	const counts = result === null ? [] : summaryTags(result, seen !== null);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
		kind: "ritual",
		href: last === null ? ritualPath(project, ritual.slug) : runPath(project, last.run),
		title: ritual.title,
		rail: railOf(state),
		live: state.tone === "run",
		chips: result === null || counts.length === 0 ? void 0 : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResultChips, {
			summary: result,
			isAnswered: seen !== null
		}),
		state,
		meta: showProject ? [project] : [],
		time,
		acts: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
			to: ritualPath(project, ritual.slug),
			children: "History"
		}),
		note: seen === null ? void 0 : seenText(last, seen, {
			today,
			offset
		}),
		excerpt: report === null ? void 0 : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Report, {
			report,
			lines: 3,
			fades: false
		}),
		className
	});
}
function workspaceExtras(project, readRun) {
	const runs = activity([project], { withImported: false });
	const djinns = project.rituals.filter((ritual) => isDjinn(ritual)).map((ritual) => {
		const finished = runs.find((run) => run.slug === ritual.slug && run.findingsSha !== null) ?? null;
		return {
			ritual,
			last: runs.find((run) => run.slug === ritual.slug) ?? null,
			report: finished === null ? null : reportExcerpt(readRun(project.name, finished.run))
		};
	});
	return {
		name: project.name,
		checkout: project.checkout,
		maxMode: project.maxMode,
		lastSync: project.lastSync,
		djinns,
		hasUnattendedWithoutDjinn: djinns.length === 0 && project.rituals.some((ritual) => isUnattended(ritual)),
		recent: runs.slice(0, 10)
	};
}
function closedVigils(projects) {
	return projects.flatMap((project) => project.vigils.filter((vigil) => vigil.state === "closed").map((vigil) => ({
		project: project.name,
		vigil
	})));
}
//#endregion
//#region app/components/route-error.tsx
/** The error boundary of every page: a 404 or a failure, inside the frame. */
function RouteError() {
	const error = useRouteError();
	if (isRouteErrorResponse(error) && error.status === 404) {
		const text = error.data === void 0 || error.data === null || error.data === "" ? "No page lives at this address." : String(error.data);
		return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "stack",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "page-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "page-title",
					children: "Nothing here"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "lede",
					children: text
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/",
				className: "back",
				children: "Back home"
			})]
		});
	}
	const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : "Unknown error";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "stack",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", {
				className: "page-head",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "page-title ink-bad",
					children: "This page failed"
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
				className: "code-block",
				children: message
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/",
				className: "back",
				children: "Back home"
			})
		]
	});
}
//#endregion
//#region app/routes/overview.tsx
var overview_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => overview_default,
	loader: () => loader$15,
	meta: () => meta$14
});
/** Latest-report rows a phone shows before its own button. */
var REPORTS_PHONE = 3;
/** Recent runs a phone shows before its own button. */
var RECENT_PHONE$1 = 3;
/**
* One loader for three addresses: `/` (the default workspace, else all),
* `/all` (all workspaces) and `/w/:ws` (one workspace).
*/
function loader$15({ context, request, params }) {
	const status = statusOf(context);
	const { scope, projects } = scopeOfRequest(status, request, params.ws);
	const read = (project, run) => context.run(project, run);
	const only = scope.workspace === null ? void 0 : projects[0];
	return {
		workspace: scope.workspace,
		home: homeView(status, read, scope),
		extras: only === void 0 ? null : workspaceExtras(only, read)
	};
}
var meta$14 = ({ data }) => [{ title: data?.workspace === null || data === void 0 ? "Overview | darius" : `Overview · ${data.workspace} | darius` }];
/** A path that may break after each slash, so a long checkout wraps at a folder. */
function PathText({ path }) {
	return path.split("/").map((part, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
		index === 0 ? "" : "/",
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("wbr", {}),
		part
	] }, `${index}`));
}
/** Under the verdict of a workspace: its limits, its last sync and where its checkout is. */
function WorkspaceMeta({ extras }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "ws-meta",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "page-meta meta-dots",
			children: [
				extras.maxMode === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
					"at most ",
					extras.maxMode,
					" mode"
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["synced ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Time, { iso: extras.lastSync })] }),
				extras.checkout === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "not linked on this host" }) : null
			]
		}), extras.checkout === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "ws-path",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PathText, { path: extras.checkout }) })
		})]
	});
}
/** The latest report of each djinn of the workspace. */
function LatestReports({ extras }) {
	const { djinns } = extras;
	if (djinns.length === 0 && extras.hasUnattendedWithoutDjinn) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		id: "reports",
		className: "section sec-reports",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectHead, { title: "Latest reports" }), djinns.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "darius runs no ritual of this workspace yet." }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "panel",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PhoneMore, {
				hidden: djinns.length - REPORTS_PHONE,
				noun: "report",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RowList, {
					bare: true,
					className: "stagger",
					children: djinns.map(({ ritual, last, report }, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReportRow, {
						project: extras.name,
						ritual,
						last,
						report,
						showProject: false,
						className: index >= REPORTS_PHONE ? "phone-extra" : void 0
					}, ritual.slug))
				})
			})
		})]
	});
}
/** The recent runs of the workspace, and the way to all of them. */
function RecentRuns({ extras }) {
	const { recent } = extras;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		id: "recent",
		className: "section sec-recent",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectHead, {
			title: "Recent runs",
			aside: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: `/runs?project=${encodeURIComponent(extras.name)}`,
				children: "All runs"
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "panel",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PhoneMore, {
				hidden: recent.length - RECENT_PHONE$1,
				noun: "run",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RunList, {
					runs: recent,
					showProject: false,
					empty: "darius has not run anything here yet.",
					phoneShown: RECENT_PHONE$1
				})
			})
		})]
	});
}
/**
* The Overview of a scope: the verdict, the Next line and the status strip on
* top (the strip only has the segments above zero). Then Needs you (only when
* something needs you), Now (only when something runs) and Last night. A
* workspace adds its latest reports, its recent runs and where its checkout
* is; all workspaces add one link to the list of all runs. What is coming up
* lives in the Rituals and Vigils sections: the Next line and the strip link
* there. On a phone the sections stack in the order of the day; on a desktop
* the wide column holds Needs you, Now and the reports, the rail holds Last
* night and the health line. Each run shows once.
*/
var overview_default = withComponentProps(function Overview({ loaderData }) {
	const { home, extras } = loaderData;
	const { verdict, tone, sub, next, strip, now, needs, lastNight, health } = home;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "proj ov",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "verdict",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: `verdict-h ink-${tone}`,
						children: verdict
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "verdict-sub",
						children: sub
					}),
					next === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NextUp, { next })
				]
			}),
			extras === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WorkspaceMeta, { extras }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusStrip$1, { segments: strip }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "board board-home",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "board-main",
					children: [
						needs.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
							className: "section sec-needs",
							id: "needs",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectHead, { title: "Needs you" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "cards",
								children: needs.map((card) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardView, { card }, card.id))
							})]
						}),
						now.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
							className: "section sec-now",
							id: "now",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectHead, { title: "Now" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NowList, { runs: now })]
						}),
						extras === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LatestReports, { extras }),
						extras === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RecentRuns, { extras })
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "board-rail",
					children: [
						lastNight.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
							className: "section sec-last",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectHead, { title: "Last night" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "panel",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DoneRows, { cards: lastNight })
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "health sec-health",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pieces, { pieces: health })
						}),
						extras === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "rail-note sec-runs",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: "/runs",
								children: "All runs"
							})
						}) : null
					]
				})]
			})
		]
	});
});
//#endregion
//#region app/components/agenda.tsx
/**
* Coming up and Waiting on an event: the two lists of `lib/agenda.ts`, drawn
* the same on the home page and on the project page. Every row is the shared
* `Row`: one link over its whole width, the icon of its kind, the title in
* full, and a second line of chips, state word and facts. A rail marks the
* rows that need attention.
*/
function AgendaItem({ row, group, showProject, anchors, target, extra }) {
	const id = anchors && row.kind === "vigil" ? vigilAnchor(row.slug) : void 0;
	const classes = [extra ? "phone-extra" : "", id !== void 0 && target === id ? "target-row is-target" : id === void 0 ? "" : "target-row"].filter((part) => part !== "");
	const state = row.state ?? (group.kind === "later" && row.date !== null ? {
		tone: "idle",
		label: shortDate(row.date)
	} : null);
	const meta = [
		showProject ? row.project : null,
		...row.facts === "" ? [] : row.facts.split(", "),
		row.note
	].filter((part) => part !== null);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
		id,
		kind: row.kind,
		manual: row.manual,
		href: row.href,
		title: row.title,
		rail: row.rail,
		chips: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindWord, {
			kind: row.kind,
			manual: row.manual
		}),
		state,
		meta,
		detail: row.until === null ? void 0 : `waits for: ${row.until}`,
		className: classes.join(" ")
	});
}
/** The label of a day group: "Overdue · 6", "Today · 2", "Tomorrow · 4", "Later · 5", or the weekday date as it is. */
function groupLabel(group) {
	return group.kind === "overdue" || group.kind === "today" || group.kind === "tomorrow" || group.kind === "later" ? `${group.label} · ${group.rows.length}` : group.label;
}
/**
* The time-ordered agenda. A phone shows Overdue, Today and Tomorrow in full,
* a few more rows, then one button. A desktop shows every day and keeps Later
* and No schedule in a fold under the list.
*/
function ComingUp({ agenda, anchors, target }) {
	const hidden = phoneHidden(agenda);
	const foldedCount = agenda.groups.filter((group) => isFolded(group)).reduce((sum, group) => sum + group.rows.length, 0);
	const pointed = anchors && agenda.groups.some((group) => group.rows.some((row) => row.kind === "vigil" && vigilAnchor(row.slug) === target && (hidden.has(row.key) || isFolded(group))));
	const [expanded, setExpanded] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		if (pointed) setExpanded(true);
	}, [pointed]);
	const toggle = () => setExpanded(!expanded);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		id: "coming-up",
		className: "section sec-coming",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectHead, { title: "Coming up" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: `panel ag phone-more${expanded ? " is-open" : ""}`,
			children: [
				agenda.groups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "panel-empty",
					children: "Nothing is scheduled."
				}) : agenda.groups.map((group) => {
					const gone = group.rows.every((row) => hidden.has(row.key));
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: `ag-group${isFolded(group) ? " desk-extra" : ""}${gone ? " phone-extra" : ""}`,
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: `ag-day ag-day-${group.kind}`,
							children: groupLabel(group)
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RowList, {
							bare: true,
							children: group.rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AgendaItem, {
								row,
								group,
								showProject: agenda.showProject,
								anchors,
								target,
								extra: hidden.has(row.key)
							}, row.key))
						})]
					}, group.key);
				}),
				hidden.size === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "phone-toggle",
					"aria-expanded": expanded,
					onClick: toggle,
					children: expanded ? "Show fewer" : `Show ${hidden.size} more`
				}),
				foldedCount === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "desk-toggle",
					"aria-expanded": expanded,
					onClick: toggle,
					children: expanded ? "Show fewer" : `Show ${foldedCount} later or without a schedule`
				})
			]
		})]
	});
}
function WaitingItem({ row, showProject, anchors, target }) {
	const id = anchors ? vigilAnchor(row.slug) : void 0;
	const cls = id === void 0 ? "" : target === id ? "target-row is-target" : "target-row";
	const state = row.flagged ? FLAGGED : null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
		id,
		kind: "vigil",
		href: row.href,
		title: row.title,
		rail: railOf(state),
		chips: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindWord, { kind: "vigil" }),
		state,
		meta: showProject ? [row.project] : [],
		detail: row.until,
		className: cls
	});
}
/** The armed vigils without a due date: flagged first, a few in view, the rest in a fold. */
function Waiting({ rows, shown, showProject, anchors, target }) {
	if (rows.length === 0) return null;
	const head = rows.slice(0, shown);
	const rest = rows.slice(shown);
	const pointed = anchors && rest.some((row) => vigilAnchor(row.slug) === target);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		id: "waiting",
		className: "section sec-waiting",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectHead, { title: "Waiting on an event" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "panel ag",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RowList, {
				bare: true,
				children: head.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WaitingItem, {
					row,
					showProject,
					anchors,
					target
				}, row.key))
			}), rest.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Fold, {
				open: pointed,
				summary: `${rest.length} more waiting`,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RowList, {
					bare: true,
					children: rest.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WaitingItem, {
						row,
						showProject,
						anchors,
						target
					}, row.key))
				})
			})]
		})]
	});
}
//#endregion
//#region app/components/section.tsx
function SectionPageHead({ title, workspace, fact }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "page-head page-head-tight proj-head",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "page-title",
			children: title
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "page-meta proj-meta meta-dots",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: workspace ?? "All workspaces" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: fact })]
		})]
	});
}
//#endregion
//#region app/lib/target.ts
/**
* The element a URL hash points at. The server never sees the hash, so the
* first render has no target and hydration matches; the target arrives
* after mount. A client navigation does not update the CSS `:target`, so
* pages mark the row themselves and scroll to it once it can be seen, for
* example after a fold opened for it.
*/
function decoded(hash) {
	const raw = hash.startsWith("#") ? hash.slice(1) : hash;
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}
function useHashTarget() {
	const { hash } = useLocation();
	const [target, setTarget] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		setTarget(decoded(hash));
	}, [hash]);
	(0, import_react.useEffect)(() => {
		if (target === "") return;
		document.getElementById(target)?.scrollIntoView({ block: "center" });
	}, [target]);
	return target;
}
//#endregion
//#region app/routes/vigils.tsx
var vigils_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => vigils_default,
	loader: () => loader$14,
	meta: () => meta$13
});
/** Rows of Waiting on an event before its fold. */
var WAITING_SHOWN = 3;
/** Closed vigils shown in their fold; a long-running workspace has dozens. */
var CLOSED_SHOWN = 10;
/** The Vigils section, for `/vigils` (all workspaces) and `/w/:ws/vigils`. */
function loader$14({ context, request, params }) {
	const status = statusOf(context);
	const { scope, projects } = scopeOfRequest(status, request, params.ws);
	const closed = closedVigils(projects);
	return {
		workspace: scope.workspace,
		agenda: buildAgenda({
			projects,
			today: status.today,
			only: "vigil"
		}),
		closed: closed.slice(0, CLOSED_SHOWN),
		closedCount: closed.length,
		showProject: projects.length > 1
	};
}
var meta$13 = ({ data }) => [{ title: data?.workspace === null || data === void 0 ? "Vigils | darius" : `Vigils · ${data.workspace} | darius` }];
/** Vigils by day (the dated ones, with the late first), the ones that wait for an event, and the closed ones in a fold. */
var vigils_default = withComponentProps(function Vigils({ loaderData }) {
	const { workspace, agenda, closed, closedCount, showProject } = loaderData;
	const target = useHashTarget();
	const closedTarget = closed.some(({ vigil }) => vigilAnchor(vigil.slug) === target);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "proj",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionPageHead, {
			title: "Vigils",
			workspace,
			fact: `${agenda.armed} armed, ${closedCount} closed`
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "proj-body",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "board",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "board-main",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ComingUp, {
						agenda,
						anchors: true,
						target
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "board-rail",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Waiting, {
						rows: agenda.waiting,
						shown: WAITING_SHOWN,
						showProject,
						anchors: true,
						target
					}), closed.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "folds proj-closed",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Fold, {
							open: closedTarget,
							summary: `Closed vigils (${closedCount})`,
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RowList, {
								bare: true,
								children: closed.map(({ project, vigil }) => {
									const id = vigilAnchor(vigil.slug);
									return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										id,
										kind: "vigil",
										title: vigil.title,
										chips: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindWord, { kind: "vigil" }),
										state: vigilWord(vigil),
										meta: [showProject ? project : null, vigil.lastOutcome === null ? null : `last check ${vigil.lastOutcome}`].filter((part) => part !== null),
										className: `target-row${target === id ? " is-target" : ""}`
									}, `${project}/${vigil.slug}`);
								})
							}), closedCount > CLOSED_SHOWN ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "rail-note mt-3",
								children: [closedCount - CLOSED_SHOWN, " older ones are not shown."]
							}) : null]
						})
					})]
				})]
			})
		})]
	});
});
//#endregion
//#region app/routes/rituals.tsx
var rituals_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => rituals_default,
	loader: () => loader$13,
	meta: () => meta$12
});
/** Recent runs a phone shows before its own button. */
var RECENT_PHONE = 3;
/** The Rituals section, for `/rituals` (all workspaces) and `/w/:ws/rituals`. */
function loader$13({ context, request, params }) {
	const status = statusOf(context);
	const { scope, projects } = scopeOfRequest(status, request, params.ws);
	const agenda = buildAgenda({
		projects,
		today: status.today,
		only: "ritual"
	});
	return {
		workspace: scope.workspace,
		agenda,
		active: agenda.groups.reduce((sum, group) => sum + group.rows.length, 0),
		recent: activity(projects, { withImported: false }).filter((run) => run.kind === "ritual").slice(0, 10)
	};
}
var meta$12 = ({ data }) => [{ title: data?.workspace === null || data === void 0 ? "Rituals | darius" : `Rituals · ${data.workspace} | darius` }];
/** Rituals by day, the late ones first, then the recent runs and the way to all of them. */
var rituals_default = withComponentProps(function Rituals({ loaderData }) {
	const { workspace, agenda, active, recent } = loaderData;
	const runsPath = workspace === null ? "/runs" : `/runs?project=${encodeURIComponent(workspace)}`;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "proj",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionPageHead, {
			title: "Rituals",
			workspace,
			fact: `${active} active, ${agenda.overdue} late`
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "proj-body",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "board",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "board-main",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ComingUp, {
						agenda,
						anchors: false,
						target: ""
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						id: "recent",
						className: "section",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectHead, {
							title: "Recent runs",
							aside: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: runsPath,
								children: "All runs"
							})
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "panel",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PhoneMore, {
								hidden: recent.length - RECENT_PHONE,
								noun: "run",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RunList, {
									runs: recent,
									showProject: workspace === null,
									empty: "darius has not run anything here yet.",
									phoneShown: RECENT_PHONE
								})
							})
						})]
					})]
				})
			})
		})]
	});
});
//#endregion
//#region app/lib/milestones.ts
/** A date that can be compared: the tracker writes YYYY-MM-DD. */
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
/** A spec slug such as `m77-01-name`, for the label fallback. */
var SPEC_SLUG = /^m(\d+)-(\d+)-/u;
/** The tick rule: all checks done, and at least one check. */
function isTicked(done, total) {
	return total > 0 && done === total;
}
/** "103 of 143 checks done"; "1 of 1 check done"; "No checks yet". */
function checksText(done, total) {
	if (total === 0) return "No checks yet";
	return `${done} of ${total} ${total === 1 ? "check" : "checks"} done`;
}
/** A spec's count without the verb: "4 of 6 checks". */
function specChecksText(done, total) {
	if (total === 0) return "no checks";
	return `${done} of ${total} ${total === 1 ? "check" : "checks"}`;
}
/** A YYYY-MM-DD date as "15 Oct", or "3 Nov 2025" in another year than today's. Anything else stays as written. */
function dateText(date, today) {
	if (!ISO_DATE.test(date)) return date;
	return date.slice(0, 4) === today.slice(0, 4) ? shortDate(date) : `${shortDate(date)} ${date.slice(0, 4)}`;
}
/** A target before today is past; a complete milestone has no late target, and a date in another shape is never past. */
function targetPast(target, today, complete) {
	return target !== null && !complete && ISO_DATE.test(target) && target < today;
}
/** The group a status belongs to. */
function groupOf(status) {
	if (status === "In Progress") return "progress";
	if (status === "Complete") return "complete";
	if (status === "Not Started") return "notstarted";
	return "closed";
}
var GROUPS = [
	{
		key: "progress",
		title: "In progress",
		tone: "gold"
	},
	{
		key: "notstarted",
		title: "Not started",
		tone: "idle"
	},
	{
		key: "complete",
		title: "Complete",
		tone: "ok"
	},
	{
		key: "closed",
		title: "Closed",
		tone: "idle"
	}
];
/** The word of a spec that is blocked, waiting or skipped; the others have no word. */
function specWord(status) {
	if (status === "Blocked") return {
		tone: "bad",
		label: "Blocked"
	};
	if (status === "Waiting") return {
		tone: "wait",
		label: "Waiting"
	};
	if (status === "Skipped") return {
		tone: "idle",
		label: "Skipped"
	};
	return null;
}
/** The word of a milestone that is not open work: skipped, deferred or closed. */
function milestoneWord(status) {
	return groupOf(status) === "closed" ? {
		tone: "idle",
		label: status
	} : null;
}
/** `M77` to 77, for ordering; 0 for an id without a number. */
function idNumber(id) {
	const match = /(\d+)/u.exec(id);
	return match === null ? 0 : Number.parseInt(match[1] ?? "0", 10);
}
/** Most recently started first, a milestone with no start date last, then the lower number first. */
function byStartedThenId(left, right) {
	if (left.started !== right.started) {
		if (left.started === null) return 1;
		if (right.started === null) return -1;
		return left.started < right.started ? 1 : -1;
	}
	return idNumber(left.id) - idNumber(right.id);
}
/** What the page calls a spec slug: its label when a spec of the workspace has it, else `M77/01` read from the slug, else the slug. */
function labelOf(slug, labels) {
	const known = labels.get(slug);
	if (known !== void 0) return known;
	const match = SPEC_SLUG.exec(slug);
	return match === null ? slug : `M${match[1] ?? ""}/${match[2] ?? ""}`;
}
function specView(spec, labels) {
	return {
		slug: spec.slug,
		label: spec.label,
		title: spec.title,
		ticked: isTicked(spec.done, spec.total),
		checks: specChecksText(spec.done, spec.total),
		dependsOn: spec.dependsOn.map((slug) => labelOf(slug, labels)),
		word: specWord(spec.status)
	};
}
/**
* The name of a milestone in its detail page URL: its id, or its directory
* name (`M12-cart`) when another open milestone of the workspace has the same
* id. src/core/legacy-milestone-detail.ts reads it back the same way.
*/
function milestoneRef(rows, row) {
	return rows.filter((candidate) => candidate.id === row.id).length > 1 ? `${row.id}-${row.slug}` : row.id;
}
/** The detail page of a milestone: `/w/<ws>/milestones/<ref>`. */
function milestonePath(workspace, ref) {
	return `${sectionPath(workspace, "milestones")}/${encodeURIComponent(ref)}`;
}
/** The labels of every spec of the workspace, for "depends on M12/01". */
function specLabels(rows) {
	return new Map(rows.flatMap((row) => row.specs.map((spec) => [spec.slug, spec.label])));
}
function milestoneView(row, today, labels, ref = row.id) {
	const complete = row.status === "Complete";
	return {
		slug: row.slug,
		id: row.id,
		ref,
		title: row.title,
		done: row.done,
		total: row.total,
		checks: checksText(row.done, row.total),
		ticked: isTicked(row.done, row.total),
		started: row.started === null ? null : dateText(row.started, today),
		target: row.target === null ? null : {
			text: dateText(row.target, today),
			past: targetPast(row.target, today, complete)
		},
		word: milestoneWord(row.status),
		specs: [...row.specs].toSorted((left, right) => left.number - right.number).map((spec) => specView(spec, labels))
	};
}
/** The milestones in their groups, in order; a group with no milestone is left out. */
function groupMilestones(rows, today) {
	const labels = specLabels(rows);
	return GROUPS.map((group) => {
		const members = rows.filter((row) => groupOf(row.status) === group.key);
		const ordered = group.key === "notstarted" ? members.toSorted((left, right) => idNumber(left.id) - idNumber(right.id)) : members.toSorted(byStartedThenId);
		return {
			key: group.key,
			title: group.title,
			tone: group.tone,
			rows: ordered.map((row) => milestoneView(row, today, labels, milestoneRef(rows, row)))
		};
	}).filter((group) => group.rows.length > 0);
}
/** One workspace of the page. */
function workspaceMilestones(project, today) {
	return {
		name: project.name,
		groups: groupMilestones(project.milestones, today),
		archived: project.milestonesArchived,
		error: project.error
	};
}
/** A workspace has something to show: open milestones or archived ones. */
function hasMilestones(workspace) {
	return workspace.groups.length > 0 || workspace.archived > 0;
}
/** The state of a milestone in words, in its group's tone: "In progress", "Deferred". */
function milestoneStatusWord(status) {
	const key = groupOf(status);
	const group = GROUPS.find((candidate) => candidate.key === key);
	return {
		tone: group?.tone ?? "idle",
		label: key === "closed" ? status : group?.title ?? status
	};
}
/** A file size: "812 B", "4.2 KB", "1.3 MB" (1 KB is 1024 bytes). */
function sizeText(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}
/** Why a file's text is not on the page. */
function omittedText(omitted) {
	if (omitted === "binary") return "not text, not shown";
	if (omitted === "too-large") return "larger than 256 KB, not shown";
	if (omitted === "unreadable") return "could not be read";
	return null;
}
/** The detail page as data. `rows` are the workspace's milestones, for the labels of specs in other milestones. */
function milestoneDetailView(detail, rows, today) {
	const labels = specLabels([detail.row, ...rows]);
	const specs = detail.specs.map(({ row, file }) => ({
		view: specView(row, labels),
		file,
		verifiedAt: row.verifiedAt === null ? null : dateText(row.verifiedAt.slice(0, 10), today),
		open: file.lines <= 40
	}));
	const counts = {
		done: 0,
		open: 0,
		waiting: 0,
		blocked: 0,
		worklogs: detail.worklogs.length
	};
	for (const { row } of detail.specs) if (isTicked(row.done, row.total)) counts.done += 1;
	else if (row.status === "Blocked") counts.blocked += 1;
	else if (row.status === "Waiting") counts.waiting += 1;
	else if (row.status !== "Skipped") counts.open += 1;
	return {
		project: detail.project,
		dir: detail.dir,
		head: milestoneView(detail.row, today, labels),
		status: milestoneStatusWord(detail.row.status),
		readme: detail.readme,
		specs,
		counts,
		worklogs: detail.worklogs,
		others: detail.others
	};
}
//#endregion
//#region app/components/milestones.tsx
/**
* The Milestones page, read-only. A milestone is one compact row: its number
* in mono, its title, a thin bar and "103 of 143 checks done". It opens in
* place (a details element) and lists its specs: a tick or an open circle, the
* label, the title, the checks, what it waits for, and Blocked, Waiting or
* Skipped in words, and a link to the milestone's own page (README, spec
* texts, worklogs). The data is in `lib/milestones.ts`.
*/
/** A tick in a circle when every check is done, an open circle otherwise. */
function Mark$1({ ticked }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		className: `ms-mark ${ticked ? "ms-mark-done" : "ms-mark-open"}`,
		width: "18",
		height: "18",
		viewBox: "0 0 18 18",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		role: "img",
		"aria-label": ticked ? "All checks done" : "Checks open",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
			cx: "9",
			cy: "9",
			r: "7.25"
		}), ticked ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.6 9.3L8 11.6L12.4 6.6" }) : null]
	});
}
/** The line under a spec title: Blocked, Waiting or Skipped, the checks, what it waits for. */
function SpecMeta({ spec }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		spec.word === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StateWord, { state: spec.word }),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: spec.checks }),
		spec.dependsOn.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `depends on ${spec.dependsOn.join(", ")}` })
	] });
}
function SpecItem({ spec }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: "ms-spec",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mark$1, { ticked: spec.ticked }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "ms-spec-main",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "ms-spec-title",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "ms-id",
					children: spec.label
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TitleText, { text: spec.title })]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "ms-spec-meta",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpecMeta, { spec })
			})]
		})]
	});
}
function MilestoneItem({ milestone, workspace }) {
	const { target } = milestone;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
		className: "ms-item",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
			className: "ms-row",
			id: milestone.id,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", {
				className: "ms-sum",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "ms-top",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "ms-id",
								children: milestone.id
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "ms-title",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TitleText, { text: milestone.title })
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "ms-chev",
								"aria-hidden": "true"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "ms-prog",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("progress", {
							className: `ms-bar${milestone.ticked ? " ms-bar-done" : ""}`,
							value: milestone.done,
							max: Math.max(milestone.total, 1),
							"aria-hidden": "true"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "ms-count",
							children: milestone.checks
						})]
					}),
					target === null || !target.past ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "ms-late ms-late-sum",
						children: `target ${target.text}, past`
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "ms-body",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "ms-meta",
						children: [
							milestone.word === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StateWord, { state: milestone.word }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: milestone.started === null ? "not started" : `started ${milestone.started}` }),
							target === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "no target" }) : target.past ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "ms-late",
								children: `target ${target.text}, past`
							}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `target ${target.text}` })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "ms-open",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: milestonePath(workspace, milestone.ref),
							children: `Open ${milestone.id}: README, spec texts, worklogs`
						})
					}),
					milestone.specs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "ms-none",
						children: "No specs yet."
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "ms-specs",
						children: milestone.specs.map((spec) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpecItem, { spec }, spec.slug))
					})
				]
			})]
		})
	});
}
function Group({ group, workspace }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: "ms-group-item",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", {
			className: `ms-group tone-${group.tone}`,
			children: [
				group.title,
				" ",
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "ms-group-n",
					children: group.rows.length
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "ms-rows",
			children: group.rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MilestoneItem, {
				milestone: row,
				workspace
			}, row.slug))
		})]
	});
}
/** The milestones of one workspace: its groups in one frame, then "N archived". */
function Workspace({ workspace, named }) {
	const empty = workspace.groups.length === 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "ms-ws",
		"aria-label": named ? void 0 : `Milestones of ${workspace.name}`,
		children: [
			named ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "ms-ws-name",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: `/w/${encodeURIComponent(workspace.name)}/milestones`,
					children: workspace.name
				})
			}) : null,
			workspace.error === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "ms-error",
				children: ["darius could not read this workspace: ", workspace.error]
			}),
			empty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "ms-empty",
				children: "No milestones in this workspace."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "ms-groups",
				children: workspace.groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Group, {
					group,
					workspace: workspace.name
				}, group.key))
			}),
			workspace.archived === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "ms-archived",
				children: `${workspace.archived} archived`
			})
		]
	});
}
//#endregion
//#region app/routes/milestones.tsx
var milestones_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => milestones_default,
	loader: () => loader$12,
	meta: () => meta$11
});
/**
* Serves `/w/:ws/milestones` (one workspace) and `/milestones` (all of them,
* grouped by workspace). The loader hands over only the milestones of the
* scope, not the status. The all-workspaces page leaves out a workspace with
* nothing to show, and the self-test workspace unless the settings ask for it.
*/
function loader$12({ context, params, request }) {
	const status = statusOf(context);
	const wanted = params.ws;
	if (wanted !== void 0) {
		const project = status.projects.find((candidate) => candidate.name === wanted);
		if (project === void 0) throw data(`No workspace named ${wanted} on this host.`, { status: 404 });
		return {
			scope: wanted,
			workspaces: [workspaceMilestones(project, status.today)]
		};
	}
	const { showSelftest } = readSettings(request.headers.get("cookie"));
	return {
		scope: null,
		workspaces: status.projects.filter((project) => showSelftest || !isSelftest(project.name)).map((project) => workspaceMilestones(project, status.today)).filter((workspace) => hasMilestones(workspace) || workspace.error !== null)
	};
}
var meta$11 = ({ data: loaded }) => [{ title: `Milestones${loaded === void 0 || loaded.scope === null ? "" : ` · ${loaded.scope}`} | darius` }];
/** Read-only: the legacy tracker's milestones, one row each, opening in place to their specs. */
var milestones_default = withComponentProps(function Milestones({ loaderData }) {
	const { scope, workspaces } = loaderData;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "ms-page",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "ms-head",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "ms-h1",
				children: "Milestones"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "ms-sub",
				children: scope === null ? "All workspaces, read-only, from the tracker" : "Read-only, from the tracker"
			})]
		}), workspaces.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "ms-empty",
			children: "No milestones in any workspace."
		}) : workspaces.map((workspace) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Workspace, {
			workspace,
			named: scope === null
		}, workspace.name))]
	});
});
//#endregion
//#region app/components/milestone-detail.tsx
/** The status strip: specs done and open, waiting and blocked when there are any, and the worklogs. */
function DetailStrip({ counts }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
		className: "pulse pulse-home msd-strip",
		"aria-label": "Summary",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, {
				label: counts.done === 1 ? "spec done" : "specs done",
				value: counts.done,
				tone: "ok",
				href: "#specs"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, {
				label: "open",
				value: counts.open,
				tone: "gold",
				href: "#specs"
			}),
			counts.waiting === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, {
				label: "waiting",
				value: counts.waiting,
				tone: "wait",
				href: "#specs"
			}),
			counts.blocked === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, {
				label: "blocked",
				value: counts.blocked,
				tone: "bad",
				href: "#specs"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, {
				label: counts.worklogs === 1 ? "worklog" : "worklogs",
				value: counts.worklogs,
				tone: "gold",
				href: counts.worklogs === 0 ? null : "#worklogs"
			})
		]
	});
}
/** A file's text, or why it is not shown. */
function FileBody({ file }) {
	const why = omittedText(file.omitted);
	if (file.body === null) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "msd-none",
		children: why ?? "No text."
	});
	if (file.body.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "msd-none",
		children: "The file is empty."
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Markdown, { blocks: file.body });
}
/** A spec: the summary is its list row, and the fold holds its full text. */
function SpecFold({ spec }) {
	const { view } = spec;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
		className: "msd-item",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
			className: "msd-fold",
			id: view.slug,
			open: spec.open,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", {
				className: "msd-sum msd-sum-spec",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mark$1, { ticked: view.ticked }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "ms-spec-main",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "ms-spec-title",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "ms-id",
								children: view.label
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TitleText, { text: view.title })]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "ms-spec-meta",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpecMeta, { spec: view }), spec.verifiedAt === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `verified ${spec.verifiedAt}` })]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "ms-chev",
						"aria-hidden": "true"
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "msd-body",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "msd-path",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: spec.file.path })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileBody, { file: spec.file })]
			})]
		})
	});
}
/** A worklog or another file: name, size and last change; the text folded below. */
function FileFold({ file, extra = [] }) {
	const why = omittedText(file.omitted);
	const meta = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
		className: "ms-spec-meta",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: sizeText(file.size) }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["changed ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Time, { iso: file.modifiedAt })] }),
			extra.map((word) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: word }, word)),
			why === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: why })
		]
	});
	if (file.body === null) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
		className: "msd-item",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "msd-sum msd-sum-file",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "ms-spec-main",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "msd-name",
					children: file.path
				}), meta]
			})
		})
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
		className: "msd-item",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
			className: "msd-fold",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", {
				className: "msd-sum msd-sum-file",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "ms-spec-main",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "msd-name",
						children: file.path
					}), meta]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "ms-chev",
					"aria-hidden": "true"
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "msd-body",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileBody, { file })
			})]
		})
	});
}
/** The words after a worklog's size: how the tracker ties it to the milestone, and a distilled stub. */
function worklogWords(worklog) {
	const words = worklog.link === "spec" ? ["a thread names a spec here"] : [];
	if (worklog.distilledAt !== null) words.push(`distilled ${worklog.distilledAt.slice(0, 10)}`);
	return words;
}
//#endregion
//#region app/routes/milestone.tsx
var milestone_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => milestone_default,
	loader: () => loader$11,
	meta: () => meta$10
});
/**
* Serves `/w/:ws/milestones/:milestone`: one milestone of the workspace's
* linked checkout in full, read-only. `:milestone` is the id (`M12`), or the
* directory name (`M12-cart`) when two open milestones share an id.
*/
function loader$11({ context, params }) {
	const status = statusOf(context);
	const project = status.projects.find((candidate) => candidate.name === params.ws);
	if (project === void 0) throw data(`No workspace named ${params.ws} on this host.`, { status: 404 });
	const detail = context.milestone(params.ws, params.milestone);
	if (detail === null) throw data(`No open milestone ${params.milestone} in workspace ${params.ws}.`, { status: 404 });
	return { view: milestoneDetailView(detail, project.milestones, status.today) };
}
var meta$10 = ({ data: loaded, params }) => [{ title: `${loaded === void 0 ? params.milestone : `${loaded.view.head.id} ${loaded.view.head.title}`} · ${params.ws} | darius` }];
/** Read-only: a legacy tracker milestone with its README, spec texts, worklogs and other files. */
var milestone_default = withComponentProps(function Milestone({ loaderData }) {
	const { view } = loaderData;
	const { head, project } = view;
	const { target } = head;
	const readmeWhy = view.readme === null ? null : omittedText(view.readme.omitted);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "ms-page msd",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "ms-head",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Crumbs, { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: workspacePath(project),
							children: project
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							"aria-hidden": "true",
							children: " / "
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: sectionPath(project, "milestones"),
							children: "Milestones"
						})
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", {
						className: "ms-h1 msd-h1",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "ms-id msd-id",
							children: head.id
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TitleText, { text: head.title })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "ms-meta msd-meta",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StateWord, { state: view.status }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: head.started === null ? "not started" : `started ${head.started}` }),
							target === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "no target" }) : target.past ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "ms-late",
								children: `target ${target.text}, past`
							}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `target ${target.text}` }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
								className: "msd-dir",
								children: `.tracker/${view.dir}/`
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "ms-prog msd-prog",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("progress", {
							className: `ms-bar${head.ticked ? " ms-bar-done" : ""}`,
							value: head.done,
							max: Math.max(head.total, 1),
							"aria-hidden": "true"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "ms-count",
							children: head.checks
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "ms-sub",
						children: "Read-only, from the tracker"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DetailStrip, { counts: view.counts }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
				title: "README",
				id: "readme",
				children: view.readme === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "This milestone has no README." }) : view.readme.body === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: readmeWhy ?? "The README could not be read." }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "msd-card measure",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Markdown, { blocks: view.readme.body })
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
				title: `Specs (${view.specs.length})`,
				id: "specs",
				children: view.specs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "No specs yet." }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "msd-list",
					children: view.specs.map((spec) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SpecFold, { spec }, spec.view.slug))
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
				title: `Worklogs (${view.worklogs.length})`,
				id: "worklogs",
				children: view.worklogs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "No worklog belongs to this milestone." }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "msd-list",
					children: view.worklogs.map((worklog) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileFold, {
						file: worklog,
						extra: worklogWords(worklog)
					}, worklog.path))
				})
			}),
			view.others.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
				title: `Other files (${view.others.length})`,
				id: "files",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "msd-list",
					children: view.others.map((file) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileFold, { file }, file.path))
				})
			})
		]
	});
});
//#endregion
//#region app/routes/settings.tsx
/**
* The settings page: how this browser shows darius, and the backups of this
* host. It is a layout: the title, a row of tabs and the tab that is open.
* The tabs are routes (General, Notifications, Backups, About), so each has
* an address and loads only its own data.
*/
var settings_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => settings_default
});
var TABS = [
	{
		to: "/settings",
		label: "General",
		end: true
	},
	{
		to: "/settings/notifications",
		label: "Notifications",
		end: false
	},
	{
		to: "/settings/backups",
		label: "Backups",
		end: false
	},
	{
		to: "/settings/about",
		label: "About",
		end: false
	}
];
var settings_default = withComponentProps(function SettingsLayout() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "st",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "page-head st-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "page-title",
					children: "Settings"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "lede",
					children: "How darius looks on this device, and how this host backs up. The look stays in this browser."
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
				"aria-label": "Settings sections",
				className: "st-tabs",
				children: TABS.map(({ to, label, end }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavLink, {
					to,
					end,
					className: ({ isActive }) => isActive ? "st-tab on" : "st-tab",
					children: label
				}, to))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {})
		]
	});
});
//#endregion
//#region app/routes/settings-general.tsx
/**
* Settings, General: how this browser shows darius. Theme, density, the
* workspace `/` opens, the self-test workspace and motion live in one cookie
* (lib/settings.ts) that the root loader reads, so the server renders the
* right theme with no flash. The page writes the cookie in the browser and
* asks for the data again; nothing reaches the store.
*/
var settings_general_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => settings_general_default,
	loader: () => loader$10,
	meta: () => meta$9
});
function loader$10({ context }) {
	return { workspaces: statusOf(context).projects.map((project) => ({
		name: project.name,
		selftest: isSelftest(project.name)
	})) };
}
var meta$9 = () => [{ title: "Settings | darius" }];
var ALL_WORKSPACES = "";
/** The cookie as `document.cookie` takes it: the whole site, a year, and Secure where the page is HTTPS. */
function cookieText(settings, secure) {
	return `${SETTINGS_COOKIE}=${settingsValue(settings)}; path=/; max-age=${SETTINGS_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
/** Put the new theme, density and motion on <html> at once; the reload of the data brings the same values. */
function paint(settings) {
	const root = document.documentElement;
	root.dataset.theme = settings.theme;
	root.dataset.density = settings.density;
	root.dataset.motion = settings.motion;
}
/** One choice of a few words: a row of buttons, one pressed. */
function Choice({ label, value, options, onPick }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "st-seg",
		role: "radiogroup",
		"aria-label": label,
		children: options.map(([option, text]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			role: "radio",
			"aria-checked": option === value,
			className: option === value ? "on" : void 0,
			onClick: () => onPick(option),
			children: text
		}, option))
	});
}
function Field({ label, hint, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "st-field",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "st-label",
				children: label
			}),
			children,
			hint === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "st-hint",
				children: hint
			})
		]
	});
}
var THEMES = [
	["dark", "Dark"],
	["light", "Light"],
	["system", "System"]
];
var DENSITIES = [["comfortable", "Comfortable"], ["compact", "Compact"]];
var MOTIONS = [["system", "System"], ["reduce", "Always"]];
var settings_general_default = withComponentProps(function SettingsGeneral({ loaderData }) {
	const root = useRouteLoaderData("root");
	const { revalidate } = useRevalidator();
	const [settings, setSettings] = (0, import_react.useState)(root?.settings ?? DEFAULT_SETTINGS);
	const change = (patch) => {
		const next = {
			...settings,
			...patch
		};
		setSettings(next);
		document.cookie = cookieText(next, location.protocol === "https:");
		paint(next);
		revalidate();
	};
	const listed = loaderData.workspaces.filter((workspace) => settings.showSelftest || !workspace.selftest || workspace.name === settings.defaultWorkspace);
	const saved = settings.defaultWorkspace;
	const names = saved !== null && !listed.some((workspace) => workspace.name === saved) ? [...listed.map((workspace) => workspace.name), saved] : listed.map((workspace) => workspace.name);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "st-body stack",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, {
				title: "Appearance",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
					label: "Theme",
					hint: "Dark is the default. System follows your device.",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Choice, {
						label: "Theme",
						value: settings.theme,
						options: THEMES,
						onPick: (theme) => change({ theme })
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
					label: "Density",
					hint: "Compact puts more rows on the screen.",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Choice, {
						label: "Density",
						value: settings.density,
						options: DENSITIES,
						onPick: (density) => change({ density })
					})
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, {
				title: "Workspaces",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
					label: "Default workspace",
					hint: "The workspace that the home address opens.",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						className: "st-select",
						"aria-label": "Default workspace",
						value: saved ?? ALL_WORKSPACES,
						onChange: (event) => change({ defaultWorkspace: event.currentTarget.value === ALL_WORKSPACES ? null : event.currentTarget.value }),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: ALL_WORKSPACES,
							children: "All workspaces"
						}), names.map((name) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: name,
							children: name
						}, name))]
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "st-toggle",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "st-toggle-text",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							id: "st-selftest",
							className: "st-label",
							children: "Show the self-test workspace"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "st-hint",
							children: "darius-selftest, used to prove an install. Hidden unless you turn this on."
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						role: "switch",
						"aria-checked": settings.showSelftest,
						"aria-labelledby": "st-selftest",
						className: "st-switch",
						onClick: () => change({ showSelftest: !settings.showSelftest })
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
				title: "Motion",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
					label: "Reduce motion",
					hint: "System follows the setting of your device.",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Choice, {
						label: "Reduce motion",
						value: settings.motion,
						options: MOTIONS,
						onPick: (motion) => change({ motion })
					})
				})
			})
		]
	});
});
//#endregion
//#region app/components/push.tsx
/**
* The notification switch (0.32.0), on the settings page since the IA work (it sat in the footer). It registers the service
* worker (web/public/sw.js), asks the host for its VAPID key, and subscribes
* this browser with `darius serve`'s push endpoints (src/web/push-api.ts):
* GET /api/push/key, POST /api/push/subscribe, POST /api/push/unsubscribe.
*
* Push needs a secure context (HTTPS, or localhost), a browser with a push
* service, and on an iPhone a darius icon on the Home Screen. When one is
* missing, the switch says what to do instead of showing a dead button.
* Everything happens in the browser: the server render only says it is checking.
*/
var WORKER = "/sw.js";
/** The VAPID key arrives as base64url; the push manager wants its bytes. */
function keyBytes(key) {
	const base64 = key.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(key.length / 4) * 4, "=");
	const text = atob(base64);
	const bytes = new Uint8Array(new ArrayBuffer(text.length));
	for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
	return bytes;
}
/** One field of a JSON reply, as text; null when it is missing or null. */
async function field(response, name) {
	const value = new Map(Object.entries(Object(await response.json()))).get(name);
	return value === null || value === void 0 ? null : String(value);
}
/** Why push cannot work in this browser, or null when it can. */
function blocker() {
	const iPhone = /iPhone|iPad|iPod/u.test(navigator.userAgent);
	const installed = window.matchMedia("(display-mode: standalone)").matches;
	if (iPhone && !installed) return "On an iPhone, add darius to the Home Screen first (Share, then Add to Home Screen), and turn notifications on there.";
	if (!window.isSecureContext) return "Notifications need HTTPS. Open darius by its https address.";
	if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "This browser cannot show push notifications.";
	if (Notification.permission === "denied") return "Notifications are blocked for this site. Allow them in the browser's site settings.";
	return null;
}
/** Where this browser stands: a reason it cannot, or whether it is subscribed. */
async function check() {
	const reason = blocker();
	if (reason !== null) return {
		kind: "unavailable",
		text: reason
	};
	const registration = await navigator.serviceWorker.register(WORKER, { scope: "/" });
	const response = await fetch("/api/push/key", { headers: { accept: "application/json" } });
	if (response.status === 404) return {
		kind: "unavailable",
		text: "This server has no notification endpoints. The dev server has none: run darius serve."
	};
	if (!response.ok) return {
		kind: "failed",
		text: `The host answered ${response.status} for its push key.`
	};
	const key = await field(response, "key");
	if (key === null) return {
		kind: "unavailable",
		text: "No push keys on this host yet (darius push keys)."
	};
	return await registration.pushManager.getSubscription() === null ? {
		kind: "off",
		key
	} : { kind: "on" };
}
async function post(path, body) {
	const response = await fetch(path, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json"
		},
		body: JSON.stringify(body)
	});
	if (response.ok) return null;
	return await field(response, "error").catch(() => null) ?? `The host answered ${response.status}.`;
}
async function turnOn(key) {
	if (await Notification.requestPermission() !== "granted") return {
		kind: "unavailable",
		text: "Notifications were not allowed. Allow them in the browser's site settings."
	};
	const subscription = await (await navigator.serviceWorker.ready).pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: keyBytes(key)
	});
	const error = await post("/api/push/subscribe", subscription.toJSON());
	if (error === null) return { kind: "on" };
	await subscription.unsubscribe();
	return {
		kind: "failed",
		text: error
	};
}
async function turnOff() {
	const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
	if (subscription === null) return check();
	const error = await post("/api/push/unsubscribe", { endpoint: subscription.endpoint });
	await subscription.unsubscribe();
	return error === null ? check() : {
		kind: "failed",
		text: error
	};
}
function failure(cause) {
	return {
		kind: "failed",
		text: `Notifications failed: ${cause.message}`
	};
}
function PushSwitch() {
	const [state, setState] = (0, import_react.useState)({ kind: "checking" });
	(0, import_react.useEffect)(() => {
		check().then(setState, (cause) => setState(failure(cause)));
	}, []);
	const run = (0, import_react.useCallback)((text, action) => {
		setState({
			kind: "busy",
			text
		});
		action().then(setState, (cause) => setState(failure(cause)));
	}, []);
	switch (state.kind) {
		case "checking": return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "push push-note",
			children: "Checking this device…"
		});
		case "unavailable": return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "push push-note",
			children: state.text
		});
		case "busy": return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "push push-note",
			children: state.text
		});
		case "failed": return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "push push-note ink-bad",
			children: [
				state.text,
				" ",
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "push-btn",
					onClick: () => run("Checking…", check),
					children: "Try again"
				})
			]
		});
		case "off": return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "push",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "push-btn",
				onClick: () => run("Turning notifications on…", () => turnOn(state.key)),
				children: "Turn on notifications"
			})
		});
		case "on": return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "push",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "push-on",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "status-dot",
					"aria-hidden": "true"
				}), "Notifications on for this device"]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "push-btn",
				onClick: () => run("Turning notifications off…", turnOff),
				children: "Turn off"
			})]
		});
	}
}
//#endregion
//#region app/routes/settings-notifications.tsx
var settings_notifications_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => settings_notifications_default,
	meta: () => meta$8
});
var meta$8 = () => [{ title: "Notifications | Settings | darius" }];
var settings_notifications_default = withComponentProps(function SettingsNotifications() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "st-body stack",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
			title: "Notifications",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "st-push",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PushSwitch, {})
			})
		})
	});
});
//#endregion
//#region app/lib/backup.ts
var LOCAL_FIELDS = [
	{
		key: "enabled",
		wire: "enabled",
		kind: "toggle",
		label: "Make snapshots",
		hint: "Off stops the timer from making new ones."
	},
	{
		key: "dir",
		wire: "dir",
		kind: "text",
		label: "Folder",
		hint: "Where this host keeps its snapshots. A leading ~ is the home folder."
	},
	{
		key: "keep",
		wire: "keep",
		kind: "number",
		label: "Keep on this host",
		hint: "The newest snapshots stay. Older ones go."
	}
];
var REMOTE_FIELDS = [
	{
		key: "endpoint",
		wire: "endpoint",
		kind: "text",
		label: "Endpoint",
		hint: "The address of the S3 service, for example https://s3.example.com."
	},
	{
		key: "bucket",
		wire: "bucket",
		kind: "text",
		label: "Bucket",
		hint: "An empty endpoint and an empty bucket mean no remote copy."
	},
	{
		key: "region",
		wire: "region",
		kind: "text",
		label: "Region",
		hint: "The region name the service expects."
	},
	{
		key: "prefix",
		wire: "prefix",
		kind: "text",
		label: "Prefix",
		hint: "A folder inside the bucket. Empty uses the top."
	},
	{
		key: "pathStyle",
		wire: "path_style",
		kind: "toggle",
		label: "Path style",
		hint: "Put the bucket in the path, not in the host name."
	},
	{
		key: "allowHttp",
		wire: "allow_http",
		kind: "toggle",
		label: "Allow plain http",
		hint: "Only for a service on a trusted network."
	},
	{
		key: "sse",
		wire: "sse",
		kind: "toggle",
		label: "Server side encryption",
		hint: "Ask the service to encrypt each object."
	},
	{
		key: "keepRemote",
		wire: "keep_remote",
		kind: "number",
		label: "Keep in the bucket",
		hint: "The newest snapshots stay. Older ones go."
	}
];
var ALL_FIELDS = [...LOCAL_FIELDS, ...REMOTE_FIELDS];
/** The variable that sets a field: `DARIUS_SNAPSHOT_KEEP_REMOTE`. */
function envName(wire) {
	return `DARIUS_SNAPSHOT_${wire.toUpperCase()}`;
}
var ENV_KEY_ID = "DARIUS_SNAPSHOT_ACCESS_KEY_ID";
var ENV_SECRET = "DARIUS_SNAPSHOT_SECRET_ACCESS_KEY";
var SOURCE_WORDS = {
	env: "set by environment",
	file: "saved here",
	config: "config.toml",
	default: "default"
};
function sourceWord(source) {
	return SOURCE_WORDS[source];
}
/** What the key pair is, in words. */
function credentialsWord(source) {
	if (source === "env") return "from the environment";
	return source === "file" ? "saved on this host" : "not set";
}
/** A short form of a sha256: the first 12 characters. */
function shortSha(sha) {
	return sha.slice(0, 12);
}
//#endregion
//#region app/lib/post.ts
function failed(status, error) {
	return {
		ok: false,
		status,
		error
	};
}
/** Read an answer: the endpoints send one JSON object, anything else is a failure. */
function parse(status, text) {
	let reply;
	try {
		reply = new Map(Object.entries(Object(JSON.parse(text))));
	} catch {
		return failed(status, `The host answered ${status} with text that is not JSON.`);
	}
	const error = reply.get("error");
	if (reply.get("ok") !== true) return failed(status, error === void 0 || error === null || error === "" ? `The host answered ${status}.` : String(error));
	const count = reply.get("count");
	return {
		ok: true,
		status,
		started: reply.get("started") === true,
		count: count === void 0 || count === null || !Number.isInteger(count) ? null : Number(count)
	};
}
/** POST `body` as JSON to `path` on this origin. */
async function postJson(path, body) {
	let response;
	try {
		response = await fetch(path, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json"
			},
			body: JSON.stringify(body)
		});
	} catch {
		return failed(0, "The host did not answer. Check the connection and try again.");
	}
	let text;
	try {
		text = await response.text();
	} catch {
		return failed(response.status, `The host answered ${response.status}, but the answer could not be read.`);
	}
	return parse(response.status, text);
}
//#endregion
//#region app/components/backups.tsx
/**
* The backups of one host (0.44.0): the state of the last run, the snapshot
* list with its delete control, the settings, the key pair of the bucket and
* a test of the bucket. Everything the person types goes out through
* `postJson` to the `/api/snapshots/...` endpoints of `darius serve`; the page
* reads the answer from the loader again after each write. There is no
* restore button on purpose: a restore overwrites the store, so the page
* shows the `tar` line and the person runs it by hand.
*
* The key pair is write-only. Its inputs start empty, are cleared after a
* save, and the page never receives the secret.
*/
var POLL_MS = 3e3;
var GIVE_UP_MS = 12e4;
function Notice({ note }) {
	if (note === null) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: `bk-note tone-${note.tone}`,
		role: note.tone === "bad" ? "alert" : "status",
		children: note.text
	});
}
function Problems({ problems }) {
	if (problems.length === 0) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "page-warn bk-problems tone-late",
		role: "alert",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "bk-problems-head",
			children: problems.length === 1 ? "One thing blocks backups." : `${problems.length} things block backups.`
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: problems.map((problem) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: problem }, problem)) })]
	});
}
/** Three lines: the last run, whether one runs now, and the bucket. */
function StateLines({ backups }) {
	const { today, offset } = useClock();
	const { last, running, remote, remoteConfigured } = backups;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
		className: "bk-state",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Last backup" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: last === null ? "No backup has run yet." : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Status, {
					tone: last.ok ? "ok" : "bad",
					label: last.ok ? "ok" : "failed"
				}),
				" ",
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Time, { iso: last.at }),
				", ",
				momentText(last.at, today, offset),
				last.name === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
					className: "bk-file",
					children: last.name
				})] }),
				last.error === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "bk-err ink-bad",
					children: last.error
				})
			] }) })] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Now" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: running === null ? "No backup runs." : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Status, {
					tone: "run",
					label: "running"
				}),
				" since ",
				momentText(running.startedAt, today, offset)
			] }) })] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Bucket" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: !remoteConfigured ? "No remote copy set up." : remote === null ? "Not contacted yet." : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Status, {
					tone: remote.ok ? "ok" : "bad",
					label: remote.ok ? "ok" : "error"
				}),
				" last contact ",
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Time, { iso: remote.at }),
				", ",
				remote.ok ? `it held ${remote.count} ${remote.count === 1 ? "snapshot" : "snapshots"}` : "the last try failed",
				remote.error === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "bk-err ink-bad",
					children: remote.error
				})
			] }) })] })
		]
	});
}
function RunButton({ backups }) {
	const { revalidate } = useRevalidator();
	const [attempt, setAttempt] = (0, import_react.useState)(null);
	const [posting, setPosting] = (0, import_react.useState)(false);
	const [note, setNote] = (0, import_react.useState)(null);
	const arrived = attempt !== null && backups.running === null && (backups.last?.at ?? null) !== attempt.baseline;
	const waiting = attempt !== null && !attempt.expired && !arrived;
	const polling = waiting || backups.running !== null;
	(0, import_react.useEffect)(() => {
		if (!polling) return;
		const timer = setInterval(() => {
			revalidate();
			if (attempt !== null && !attempt.expired && Date.now() - attempt.since > GIVE_UP_MS) {
				setAttempt({
					...attempt,
					expired: true
				});
				setNote({
					tone: "bad",
					text: "No result after 2 minutes. Open this page later to see how the run ended."
				});
			}
		}, POLL_MS);
		return () => clearInterval(timer);
	}, [
		polling,
		attempt,
		revalidate
	]);
	const press = async () => {
		setPosting(true);
		setNote(null);
		const result = await postJson("/api/snapshots/run", {});
		setPosting(false);
		if (result.ok) {
			setAttempt({
				since: Date.now(),
				baseline: backups.last?.at ?? null,
				expired: false
			});
			revalidate();
			return;
		}
		setNote({
			tone: "bad",
			text: result.status === 409 ? "A backup is already running." : result.error
		});
		if (result.status === 409) revalidate();
	};
	const busy = posting || waiting || backups.running !== null;
	const label = posting || waiting && backups.running === null ? "Starting…" : busy ? "Backup is running…" : "Back up now";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "bk-run",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			className: "bk-btn bk-btn-main",
			disabled: busy,
			onClick: () => void press(),
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, { note })]
	});
}
function Mark({ on, yes, no }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: on ? "bk-mark tone-ok" : "bk-mark bk-mark-off tone-idle",
		children: on ? yes : no
	});
}
function SnapshotRow({ row, remoteConfigured }) {
	const { today, offset } = useClock();
	const { revalidate } = useRevalidator();
	const [showSha, setShowSha] = (0, import_react.useState)(false);
	const [ask, setAsk] = (0, import_react.useState)(null);
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [note, setNote] = (0, import_react.useState)(null);
	const remove = async (where) => {
		setBusy(true);
		setNote(null);
		const result = await postJson("/api/snapshots/delete", {
			name: row.name,
			where
		});
		setBusy(false);
		setAsk(null);
		if (result.ok) revalidate();
		else setNote({
			tone: "bad",
			text: result.error
		});
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: "bk-snap",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "bk-snap-head",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", {
						dateTime: row.at,
						title: row.at,
						className: "bk-when",
						children: momentText(row.at, today, offset)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "bk-size",
						children: byteSize(row.bytes)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "bk-files",
						children: row.files === null ? "files not known" : `${row.files} ${row.files === 1 ? "file" : "files"}`
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "bk-marks",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mark, {
					on: row.local,
					yes: "on this host",
					no: "not on this host"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mark, {
					on: row.remote,
					yes: "in the bucket",
					no: "not in the bucket"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "bk-name",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: row.name })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "bk-sha",
				children: row.sha256 === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "text-muted",
					children: "No checksum on record."
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "bk-sha-label",
						children: "sha256"
					}),
					" ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "bk-sha-btn",
						"aria-expanded": showSha,
						onClick: () => setShowSha(!showSha),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: showSha ? row.sha256 : `${shortSha(row.sha256)}…` })
					})
				] })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "bk-acts",
				children: ask === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [row.local ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "bk-btn bk-btn-quiet",
					disabled: busy,
					onClick: () => setAsk("local"),
					children: "Delete here"
				}) : null, row.remote && remoteConfigured ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "bk-btn bk-btn-quiet",
					disabled: busy,
					onClick: () => setAsk("remote"),
					children: "Delete in bucket"
				}) : null] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "bk-ask",
					role: "group",
					"aria-label": "Confirm the delete",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "bk-ask-q",
							children: ask === "local" ? "Delete from this host?" : "Delete from the bucket?"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "bk-btn bk-btn-danger",
							disabled: busy,
							onClick: () => void remove(ask),
							children: "Yes"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "bk-btn bk-btn-quiet",
							disabled: busy,
							onClick: () => setAsk(null),
							children: "No"
						})
					]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, { note })
		]
	});
}
function SnapshotList({ backups }) {
	const { snapshots, remoteConfigured, storePath, localBytes } = backups;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "bk-block",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "bk-h",
				children: "Snapshots"
			}),
			snapshots.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "panel-empty bk-empty",
				children: "No snapshot yet. Press Back up now."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "bk-sum",
				children: [
					snapshots.length,
					" ",
					snapshots.length === 1 ? "snapshot" : "snapshots",
					", newest first. This host holds ",
					byteSize(localBytes),
					"."
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "bk-list",
				children: snapshots.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SnapshotRow, {
					row,
					remoteConfigured
				}, row.name))
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "bk-restore",
				children: [
					"To restore by hand, stop the web service and the timers first. Then run ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("code", {
						className: "inline-code",
						children: [
							"tar -xzf ",
							"<file>",
							" -C ",
							storePath
						]
					}),
					". There is no restore button on purpose: a restore overwrites the store."
				]
			})
		]
	});
}
/** The value of a field as the page shows it: a boolean for a toggle, text otherwise. */
function shown(backups, field) {
	const value = backups.settings[field.key].value;
	return field.kind === "toggle" ? value === true : String(value);
}
function Source({ field, backups, busy, onReset }) {
	const { source } = backups.settings[field.key];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
		className: "st-hint bk-src",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: `bk-source bk-source-${source}`,
				children: sourceWord(source)
			}),
			source === "env" ? ` by ${envName(field.wire)}. Change it where the service starts.` : "",
			source === "file" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [" ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "bk-link",
				disabled: busy,
				onClick: () => onReset(field),
				children: "Reset to default"
			})] }) : null
		]
	});
}
function SettingField({ field, backups, draft, busy, onChange, onReset }) {
	const locked = backups.settings[field.key].source === "env";
	const value = draft.get(field.key) ?? shown(backups, field);
	const id = `bk-set-${field.wire}`;
	if (field.kind === "toggle") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "st-field bk-field",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "st-toggle",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "st-toggle-text",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					id,
					className: "st-label",
					children: field.label
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "st-hint",
					children: field.hint
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				role: "switch",
				"aria-checked": value === true,
				"aria-labelledby": id,
				disabled: locked,
				className: "st-switch",
				onClick: () => onChange(field, value !== true)
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Source, {
			field,
			backups,
			busy,
			onReset
		})]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "st-field bk-field",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
				htmlFor: id,
				className: "st-label",
				children: field.label
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				id,
				className: "bk-input",
				type: field.kind === "number" ? "number" : "text",
				inputMode: field.kind === "number" ? "numeric" : void 0,
				min: field.kind === "number" ? 0 : void 0,
				step: field.kind === "number" ? 1 : void 0,
				autoComplete: "off",
				autoCapitalize: "off",
				spellCheck: false,
				disabled: locked,
				value: String(value),
				onChange: (event) => onChange(field, event.currentTarget.value)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "st-hint",
				children: field.hint
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Source, {
				field,
				backups,
				busy,
				onReset
			})
		]
	});
}
/** The request value of a changed field, or the sentence that says why it cannot go. */
function requestValue(field, value) {
	if (field.kind === "toggle") return {
		ok: true,
		value: value === true
	};
	const text = String(value).trim();
	if (field.kind === "text") return {
		ok: true,
		value: text
	};
	const number = Number(text);
	if (text === "" || !Number.isInteger(number) || number < 0) return {
		ok: false,
		error: `${field.label} must be a whole number, 0 or more.`
	};
	return {
		ok: true,
		value: number
	};
}
function SettingsForm({ backups }) {
	const { revalidate } = useRevalidator();
	const [draft, setDraft] = (0, import_react.useState)(/* @__PURE__ */ new Map());
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [note, setNote] = (0, import_react.useState)(null);
	const change = (field, value) => {
		const next = new Map(draft);
		if (value === shown(backups, field)) next.delete(field.key);
		else next.set(field.key, value);
		setDraft(next);
		setNote(null);
	};
	const finish = (text) => {
		setNote({
			tone: "ok",
			text
		});
		revalidate();
	};
	const reset = async (field) => {
		setBusy(true);
		setNote(null);
		const result = await postJson("/api/snapshots/settings", { values: { [field.wire]: null } });
		setBusy(false);
		if (!result.ok) {
			setNote({
				tone: "bad",
				text: result.error
			});
			return;
		}
		const next = new Map(draft);
		next.delete(field.key);
		setDraft(next);
		finish(`${field.label} is back to its default.`);
	};
	const save = async () => {
		const values = /* @__PURE__ */ new Map();
		for (const field of ALL_FIELDS) {
			const value = draft.get(field.key);
			if (value === void 0 || backups.settings[field.key].source === "env") continue;
			const checked = requestValue(field, value);
			if (!checked.ok) {
				setNote({
					tone: "bad",
					text: checked.error
				});
				return;
			}
			values.set(field.wire, checked.value);
		}
		setBusy(true);
		setNote(null);
		const result = await postJson("/api/snapshots/settings", { values: Object.fromEntries(values) });
		setBusy(false);
		if (!result.ok) {
			setNote({
				tone: "bad",
				text: result.error
			});
			return;
		}
		setDraft(/* @__PURE__ */ new Map());
		finish("Saved.");
	};
	const group = (title, fields) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", {
		className: "bk-group",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", {
			className: "bk-legend",
			children: title
		}), fields.map((field) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SettingField, {
			field,
			backups,
			draft,
			busy,
			onChange: change,
			onReset: (target) => void reset(target)
		}, field.key))]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "bk-block",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
			className: "bk-h",
			children: "Settings"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "panel panel-pad bk-panel",
			children: [
				group("Local", LOCAL_FIELDS),
				group("Remote copy (S3 bucket)", REMOTE_FIELDS),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "bk-save",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "bk-btn bk-btn-main",
						disabled: busy || draft.size === 0,
						onClick: () => void save(),
						children: "Save settings"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "st-hint",
						children: draft.size === 0 ? "Nothing changed." : `${draft.size} ${draft.size === 1 ? "change" : "changes"} to save.`
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, { note })
			]
		})]
	});
}
function Credentials({ backups }) {
	const { revalidate } = useRevalidator();
	const [keyId, setKeyId] = (0, import_react.useState)("");
	const [secret, setSecret] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [note, setNote] = (0, import_react.useState)(null);
	const { credentials } = backups;
	const send = async (path, body, done) => {
		setBusy(true);
		setNote(null);
		const result = await postJson(path, body);
		setBusy(false);
		setSecret("");
		if (!result.ok) {
			setNote({
				tone: "bad",
				text: result.error
			});
			return;
		}
		setKeyId("");
		setNote({
			tone: "ok",
			text: done
		});
		revalidate();
	};
	const store = () => {
		if (keyId.trim() === "" || secret === "") {
			setNote({
				tone: "bad",
				text: "Fill in both the access key id and the secret key."
			});
			return;
		}
		send("/api/snapshots/credentials", {
			accessKeyId: keyId.trim(),
			secretAccessKey: secret
		}, "The key pair is saved on this host.");
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "bk-block",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
			className: "bk-h",
			children: "Key pair for the bucket"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "panel panel-pad bk-panel",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "bk-cred-line",
					children: [
						"The key pair is ",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: credentialsWord(credentials) }),
						"."
					]
				}),
				credentials === "env" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "st-hint",
					children: [
						"The environment sets it, through ",
						ENV_KEY_ID,
						" and ",
						ENV_SECRET,
						". This page cannot change it."
					]
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "bk-cred",
					role: "group",
					"aria-label": "Save a key pair",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "st-field bk-field",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
								htmlFor: "bk-key-id",
								className: "st-label",
								children: "Access key id"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								id: "bk-key-id",
								className: "bk-input",
								type: "text",
								autoComplete: "off",
								autoCapitalize: "off",
								spellCheck: false,
								value: keyId,
								onChange: (event) => setKeyId(event.currentTarget.value)
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "st-field bk-field",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
									htmlFor: "bk-secret",
									className: "st-label",
									children: "Secret key"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									id: "bk-secret",
									className: "bk-input",
									type: "password",
									autoComplete: "off",
									autoCapitalize: "off",
									spellCheck: false,
									value: secret,
									onChange: (event) => setSecret(event.currentTarget.value),
									onKeyDown: (event) => {
										if (event.key === "Enter") store();
									}
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "st-hint",
									children: "The page writes the pair to this host and never shows it again."
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "bk-save",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "bk-btn bk-btn-main",
								disabled: busy,
								onClick: store,
								children: "Save the key pair"
							}), credentials === "file" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "bk-btn bk-btn-quiet",
								disabled: busy,
								onClick: () => void send("/api/snapshots/credentials/clear", {}, "The saved key pair is removed."),
								children: "Remove the saved key"
							}) : null]
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, { note })
			]
		})]
	});
}
function BucketTest({ backups }) {
	const { revalidate } = useRevalidator();
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [note, setNote] = (0, import_react.useState)(null);
	const test = async () => {
		setBusy(true);
		setNote(null);
		const result = await postJson("/api/snapshots/check", {});
		setBusy(false);
		if (!result.ok) {
			setNote({
				tone: "bad",
				text: result.error
			});
			return;
		}
		revalidate();
		setNote({
			tone: "ok",
			text: result.count === null ? "The bucket works." : `The bucket works. It lists ${result.count} ${result.count === 1 ? "object" : "objects"}.`
		});
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "bk-block",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
			className: "bk-h",
			children: "Test the bucket"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "panel panel-pad bk-panel",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "st-hint",
					children: "Lists the bucket, then writes and deletes one small test object. It uses the saved settings."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "bk-save",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "bk-btn bk-btn-quiet",
						disabled: busy || !backups.remoteConfigured,
						onClick: () => void test(),
						children: busy ? "Testing…" : "Test the bucket"
					}), backups.remoteConfigured ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "st-hint",
						children: "Set the endpoint and the bucket first."
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, { note })
			]
		})]
	});
}
function EnvHelp({ backups }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Fold, {
		summary: "Set these with environment variables",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "st-hint",
			children: [
				"Put the lines in ",
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
					className: "inline-code",
					children: backups.envFile
				}),
				". The timer and this page read that file. Restart the web service after a change. An environment value wins over this page."
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
			className: "bk-env",
			children: [
				ALL_FIELDS.map((field) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: envName(field.wire) }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: field.hint })] }, field.wire)),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: ENV_KEY_ID }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: "The access key id of the bucket." })] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: ENV_SECRET }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: "The secret key of the bucket." })] })
			]
		})]
	});
}
function Backups({ backups }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
		title: "Backups",
		id: "backups",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "bk",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Problems, { problems: backups.problems }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "bk-grid",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "bk-col",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "bk-block",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
								className: "bk-h",
								children: "State"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "panel panel-pad bk-panel",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StateLines, { backups }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RunButton, { backups })]
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SnapshotList, { backups }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BucketTest, { backups }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(EnvHelp, { backups })
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "bk-col",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SettingsForm, { backups }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Credentials, { backups })]
				})]
			})]
		})
	});
}
//#endregion
//#region app/routes/settings-backups.tsx
var settings_backups_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => settings_backups_default,
	loader: () => loader$9,
	meta: () => meta$7
});
function loader$9({ context }) {
	return { backups: context.backups() };
}
var meta$7 = () => [{ title: "Backups | Settings | darius" }];
var settings_backups_default = withComponentProps(function SettingsBackups({ loaderData }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Backups, { backups: loaderData.backups });
});
//#endregion
//#region app/routes/settings-about.tsx
/** Settings, About: the host, the version, who is looking and the way to the profiles. */
var settings_about_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => settings_about_default,
	loader: () => loader$8,
	meta: () => meta$6
});
function loader$8({ context }) {
	return { profiles: statusOf(context).profiles.length };
}
var meta$6 = () => [{ title: "About | Settings | darius" }];
var settings_about_default = withComponentProps(function SettingsAbout({ loaderData }) {
	const root = useRouteLoaderData("root");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "st-body stack",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
			title: "About",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
				className: "st-about",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Host" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: root?.host })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Version" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", { children: ["darius ", root?.version] })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Seen by" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: root?.viewer })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Profiles" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/profiles",
						className: "st-about-link",
						children: loaderData.profiles === 0 ? "None yet" : `${loaderData.profiles} ${loaderData.profiles === 1 ? "profile" : "profiles"}`
					}) })] })
				]
			})
		})
	});
});
//#endregion
//#region app/components/system.tsx
/**
* The machine and the store, for the status page (0.44.0): the strip of
* small facts at the top, then the machine, the hosts that sync, and the
* projects with their last sync. Read-only. Every row is a line, not a tile.
*/
var DAY_MS = 864e5;
/** One fact of the strip: the same square, number and word as the `Pill` of a project page, with text for a value. */
function FactPill({ value, label, tone, to }) {
	const inner = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "pill-dot",
			"aria-hidden": "true"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "pill-n",
			children: value
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "pill-l",
			children: label
		})
	] });
	if (to === void 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: `pill tone-${tone}`,
		children: inner
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
		to,
		className: `pill tone-${tone}`,
		children: inner
	});
}
/** How long ago, in the words of `relativeTime` without "ago": "5 min", "3 h", "2 d". */
function since(iso, now) {
	const text = relativeTime(iso, now);
	return text === "just now" ? "0 min" : text.replace(" ago", "");
}
function newestSync(projects) {
	return projects.flatMap((project) => project.lastSync === null ? [] : [project.lastSync]).toSorted((left, right) => right.localeCompare(left))[0] ?? null;
}
function backupFact(backups, now) {
	if (backups.running !== null) return {
		value: "running",
		label: "backup",
		tone: "run"
	};
	if (backups.last === null) return {
		value: "none",
		label: "backup yet",
		tone: "idle"
	};
	if (!backups.last.ok) return {
		value: "failed",
		label: "backup",
		tone: "bad"
	};
	return {
		value: since(backups.last.at, now),
		label: "since backup",
		tone: "ok"
	};
}
/** The status strip: six small facts in one block. */
function StatusStrip({ system, backups }) {
	const { now } = useClock();
	const sync = newestSync(system.projects);
	const backup = backupFact(backups, now);
	const syncTone = sync === null ? "idle" : now - Date.parse(sync) > DAY_MS ? "late" : "ok";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
		className: "pulse pulse-home pulse-status stagger",
		"aria-label": "Summary",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FactPill, {
				value: String(system.hosts.length),
				label: system.hosts.length === 1 ? "host" : "hosts",
				tone: "gold"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FactPill, {
				value: String(system.store.rituals + system.store.vigils),
				label: "items",
				tone: "gold"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FactPill, {
				value: String(system.store.runs),
				label: "runs",
				tone: "gold"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FactPill, {
				value: byteSize(system.store.bytes),
				label: "store",
				tone: "gold"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FactPill, {
				value: sync === null ? "never" : since(sync, now),
				label: sync === null ? "synced" : "since sync",
				tone: syncTone
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FactPill, {
				value: backup.value,
				label: backup.label,
				tone: backup.tone,
				to: "/settings/backups"
			})
		]
	});
}
function usedPercent(disk) {
	if (disk.totalBytes <= 0) return 0;
	return Math.min(100, Math.max(0, Math.round((disk.totalBytes - disk.freeBytes) / disk.totalBytes * 100)));
}
/** A thin bar, drawn as an SVG so the page needs no inline style. */
function UsageBar({ disk }) {
	const used = usedPercent(disk);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		className: `sy-bar tone-${used >= 90 ? "bad" : used >= 75 ? "late" : "gold"}`,
		viewBox: "0 0 100 4",
		preserveAspectRatio: "none",
		role: "img",
		"aria-label": `${used} percent used`,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
			className: "sy-bar-back",
			x: "0",
			y: "0",
			width: "100",
			height: "4"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
			className: "sy-bar-fill",
			x: "0",
			y: "0",
			width: used,
			height: "4"
		})]
	});
}
function DiskRow({ disk }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "sy-disk",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "sy-disk-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "sy-disk-label",
					children: disk.label === "store" ? "Store disk" : disk.label === "backups" ? "Backups disk" : disk.label
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "sy-disk-free",
					children: [
						byteSize(disk.freeBytes),
						" free of ",
						byteSize(disk.totalBytes)
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageBar, { disk }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
				className: "sy-path",
				children: disk.path
			})
		]
	});
}
function Machine({ system }) {
	const used = system.memory.totalBytes - system.memory.freeBytes;
	const rows = [
		["Host", system.host],
		["darius", system.version],
		["Runtime", system.runtime],
		["Platform", system.platform],
		["Up for", uptimeText(system.uptimeSeconds)],
		["Load 1, 5, 15 min", system.load.map((value) => value.toFixed(2)).join(", ")],
		["Memory", `${byteSize(used)} used of ${byteSize(system.memory.totalBytes)}`]
	];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, {
		title: "Machine",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", {
			className: "sy-rows panel",
			children: rows.map(([name, value]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: name }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: value })] }, name))
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "sy-disks",
			children: system.disks.map((disk) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DiskRow, { disk }, disk.label))
		})]
	});
}
function HostRow({ host }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: "sy-item",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "sy-item-head",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "sy-name",
				children: host.host
			}), host.self ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "bk-mark tone-ok",
				children: "this host"
			}) : null]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "sy-meta",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["last seen ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Time, { iso: host.lastSeen })] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
					host.chunks,
					" ",
					host.chunks === 1 ? "chunk" : "chunks"
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: host.projects.length === 0 ? "no projects" : host.projects.join(", ") })
			]
		})]
	});
}
function Hosts({ hosts }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
		title: "Hosts",
		children: hosts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "panel-empty panel",
			children: "No host has written to this store yet."
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "sy-list panel",
			children: hosts.map((host) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HostRow, { host }, host.host))
		})
	});
}
function ProjectRow({ project }) {
	const { today, offset } = useClock();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: "sy-item",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "sy-item-head",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "sy-name",
				children: project.project
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "sy-size",
				children: byteSize(project.bytes)
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "sy-meta",
			children: [
				project.lastSync === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "ink-idle",
					children: "never synced"
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
					"synced ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Time, { iso: project.lastSync }),
					", ",
					momentText(project.lastSync, today, offset)
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
					project.rituals,
					" ",
					project.rituals === 1 ? "ritual" : "rituals"
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
					project.vigils,
					" ",
					project.vigils === 1 ? "vigil" : "vigils"
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
					project.runs,
					" ",
					project.runs === 1 ? "run" : "runs"
				] })
			]
		})]
	});
}
function Projects({ system }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, {
		title: "Projects and syncs",
		children: [system.projects.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "panel-empty panel",
			children: "This store holds no project yet."
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "sy-list panel",
			children: system.projects.map((project) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProjectRow, { project }, project.project))
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "sy-remote",
			children: system.syncRemote === null ? "This host has no sync bucket." : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
				"Sync bucket: ",
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: system.syncRemote.bucket }),
				" at ",
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: system.syncRemote.endpoint }),
				"."
			] })
		})]
	});
}
//#endregion
//#region app/routes/status.tsx
/**
* The status page of one darius host (0.44.0): the machine and the store, the
* hosts that sync and the last syncs. The backups live in the settings
* (`/settings/backups`); this page keeps the "since backup" pill and a line
* when they have a problem. The root route reloads every loader each minute,
* so this page stays current.
*/
var status_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => status_default,
	loader: () => loader$7,
	meta: () => meta$5
});
function loader$7({ context }) {
	return {
		system: context.system(),
		backups: context.backups()
	};
}
var meta$5 = () => [{ title: "Status | darius" }];
/** What is wrong with the backups, in one short sentence; null when nothing is. */
function backupTrouble(backups) {
	if (backups.problems.length > 0) return backups.problems.length === 1 ? "One thing blocks backups." : `${backups.problems.length} things block backups.`;
	if (backups.last !== null && !backups.last.ok) return "The last backup failed.";
	return null;
}
var status_default = withComponentProps(function StatusPage({ loaderData }) {
	const { system, backups } = loaderData;
	const trouble = backupTrouble(backups);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "stack",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "page-head page-head-tight",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "page-title",
					children: "Status"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "lede",
					children: [
						system.host,
						", darius ",
						system.version,
						". The machine, the store and the sync of this host."
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusStrip, {
				system,
				backups
			}),
			trouble === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "page-warn tone-late",
				role: "status",
				children: [
					trouble,
					" ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/settings/backups",
						children: "Open the backups"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "sy-grid",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Machine, { system }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Hosts, { hosts: system.hosts })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Projects, { system })
		]
	});
});
//#endregion
//#region app/routes/runs.tsx
var runs_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => runs_default,
	loader: () => loader$6,
	meta: () => meta$4
});
var STATES = [
	"held",
	"running",
	"complete",
	"failed",
	"abandoned"
];
function matches(run, state) {
	if (state === "") return true;
	if (state === "held" || state === "running") return run.phase === state;
	return run.phase === "closed" && run.outcome === state;
}
function loader$6({ context, request }) {
	const params = new URL(request.url).searchParams;
	const project = params.get("project") ?? "";
	const state = params.get("state") ?? "";
	const withImported = params.get("imported") === "1";
	const status = statusOf(context);
	const { showSelftest } = readSettings(request.headers.get("cookie"));
	const projects = project === "" ? scopeProjects(status, {
		workspace: null,
		includeSelftest: showSelftest
	}) : status.projects;
	return {
		runs: activity(projects.filter((candidate) => project === "" || candidate.name === project), { withImported }).filter((run) => matches(run, state)),
		project,
		state,
		withImported,
		projects: projects.map((candidate) => candidate.name)
	};
}
var meta$4 = () => [{ title: "Runs | darius" }];
function href(query) {
	const params = new URLSearchParams();
	if (query.project !== "") params.set("project", query.project);
	if (query.state !== "") params.set("state", query.state);
	if (query.withImported) params.set("imported", "1");
	const text = params.toString();
	return text === "" ? "/runs" : `/runs?${text}`;
}
var STATE_WORDS = /* @__PURE__ */ new Map([
	["", "All runs"],
	["held", "Held runs"],
	["running", "Runs still running"],
	["complete", "Complete runs"],
	["failed", "Failed runs"],
	["abandoned", "Abandoned runs"]
]);
/** The filter in words: "Held runs in acme-web, newest first." */
function filterText(query) {
	return `${STATE_WORDS.get(query.state) ?? `Runs that ended ${query.state}`}${query.project === "" ? " of every project" : ` in ${query.project}`}${query.withImported ? ", imported runs included" : ""}, newest first.`;
}
function chipClass(isActive, isToggle = false) {
	const kind = isToggle ? "fchip fchip-toggle" : "fchip";
	return isActive ? `${kind} fchip-on` : kind;
}
/**
* One row of filter chips. On a phone the row scrolls sideways instead of
* wrapping, so the filter stays two lines tall; the chip that is on is
* scrolled into view, so the row never hides the current filter.
*/
function ChipRow({ label, current, children }) {
	const row = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => {
		const element = row.current;
		if (element === null) return;
		const on = element.querySelector(".fchip-on:not(.fchip-toggle)");
		if (on === null) return;
		element.scrollLeft = Math.max(0, on.offsetLeft - (element.clientWidth - on.offsetWidth) / 2);
	}, [current]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		ref: row,
		role: "group",
		"aria-label": label,
		className: "fchips",
		children
	});
}
var runs_default = withComponentProps(function Runs({ loaderData }) {
	const { runs, project, state, withImported, projects } = loaderData;
	const query = {
		project,
		state,
		withImported
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "page-head",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "page-title",
			children: "Runs"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "page-meta",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: filterText(query) })
		})]
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "board",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "board-main",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "panel",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RunList, {
					runs,
					showProject: project === "",
					empty: "No run matches this filter."
				})
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("aside", {
			className: "board-rail rail-first rail-filter",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
				title: "Filter",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
					"aria-label": "Filter",
					className: "filters panel panel-pad",
					children: [projects.length < 2 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ChipRow, {
						label: "Project",
						current: project,
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: href({
								...query,
								project: ""
							}),
							className: chipClass(project === ""),
							"aria-current": project === "" ? "true" : void 0,
							children: "all projects"
						}), projects.map((name) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: href({
								...query,
								project: name
							}),
							className: chipClass(project === name),
							"aria-current": project === name ? "true" : void 0,
							children: name
						}, name))]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ChipRow, {
						label: "State",
						current: state,
						children: [["", ...STATES].map((name) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: href({
								...query,
								state: name
							}),
							className: chipClass(name === state),
							"aria-current": name === state ? "true" : void 0,
							children: name === "" ? "any state" : name
						}, name)), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: href({
								...query,
								withImported: !withImported
							}),
							className: chipClass(withImported, true),
							"aria-current": withImported ? "true" : void 0,
							children: withImported ? "with imported runs" : "show imported runs"
						})]
					})]
				})
			})
		})]
	})] });
});
//#endregion
//#region app/routes/legacy-run.tsx
var legacy_run_exports = /* @__PURE__ */ __exportAll({ loader: () => loader$5 });
function loader$5({ params }) {
	return redirect(runPath(params.project, params.run), 301);
}
//#endregion
//#region app/routes/profiles.tsx
var profiles_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => profiles_default,
	loader: () => loader$4,
	meta: () => meta$3
});
var DEFAULT_PROFILE = "default";
function loader$4({ context }) {
	return { profiles: statusOf(context).profiles };
}
var meta$3 = () => [{ title: "Profiles | darius" }];
var profiles_default = withComponentProps(function Profiles({ loaderData }) {
	const { profiles } = loaderData;
	const hasDefault = profiles.some((profile) => profile.name === DEFAULT_PROFILE);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "page-head",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "page-title",
			children: "Profiles"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "lede",
			children: [
				"How darius starts a harness for a ritual. A ritual picks a profile by name.",
				" ",
				hasDefault ? "A ritual that names none uses the profile named default, unless its repo picks another in .darius.toml." : "A ritual that names none, in a repo that picks none, runs with the harness defaults: Claude Code, headless, permissions skipped, so the darius gate alone decides."
			]
		})]
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "board",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "board-main",
			children: profiles.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "No profile yet. Add one with darius profile add." }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "rows",
				children: profiles.map((profile) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					id: `profile-${profile.name}`,
					className: "row target-row",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "row-main",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "row-title font-mono",
								children: profile.name
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "row-sub",
								children: [
									profile.harness,
									profile.model ?? "default model",
									profile.effort === null ? null : `${profile.effort} effort`,
									`${profile.permissions} permissions`,
									profile.surface
								].filter((part) => part !== null).join(", ")
							}),
							profile.name === DEFAULT_PROFILE ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "mt-1",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Status, {
									tone: "gold",
									label: "used when a ritual names none"
								})
							}) : null
						]
					})
				}, profile.name))
			})
		})
	})] });
});
//#endregion
//#region app/routes/project.tsx
var project_exports = /* @__PURE__ */ __exportAll({
	default: () => project_default,
	loader: () => loader$3
});
/** `/p/<project>` was the project page; a project is now a workspace, and its Overview is `/w/<project>`. Old links keep working. */
function loader$3({ params }) {
	return redirect(workspacePath(params.project), 301);
}
var project_default = withComponentProps(function Project() {
	return null;
});
//#endregion
//#region app/routes/ritual.tsx
var ritual_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => ritual_default,
	loader: () => loader$2,
	meta: () => meta$2
});
function loader$2({ context, params }) {
	const ritual = context.ritual(params.project, params.slug);
	if (ritual === null) throw data(`No ritual ${params.slug} in project ${params.project}.`, { status: 404 });
	const finished = ritual.runs.find((run) => run.findingsSha !== null && !isImported(run)) ?? null;
	const held = ritual.row.heldRun === null ? null : ritual.runs.find((run) => run.run === ritual.row.heldRun) ?? null;
	const status = statusOf(context);
	const failure = ritualFailure(ritual.project, ritual.row, ritual.runs, status.today);
	const next = failure === null ? null : nextStep(failure, {
		today: status.today,
		offset: status.utcOffset
	});
	const detail = finished === null ? null : context.run(ritual.project, finished.run);
	return {
		ritual,
		held,
		finished,
		next,
		asks: finished !== null && asksYou(finished) ? detail?.result?.questions ?? [] : [],
		report: reportExcerpt(detail)
	};
}
var meta$2 = ({ data: loaded, params }) => [{ title: `${loaded?.ritual.row.title ?? "Ritual"} · ${params.project} | darius` }];
/** What darius puts at the top of the next run's prompt: the run's note and the operator's note on that run. */
function HandoffCard({ handoff }) {
	const { operator } = handoff;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "card",
		children: [handoff.note === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-muted",
			children: "The latest run left no note."
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: handoff.note }), operator === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "rail-note",
			children: [
				handoff.questions.length > 0 ? "Your answer" : "Your note",
				", ",
				operator.who,
				": ",
				operator.note
			]
		})]
	});
}
function modeText(mode) {
	if (mode === "report") return "read-only, it reports and asks before any change";
	if (mode === "act") return "it may change things within its rules";
	return mode;
}
var ritual_default = withComponentProps(function Ritual({ loaderData }) {
	const { ritual, held, finished, next, asks, report } = loaderData;
	const { row, policy, project } = ritual;
	const manual = isManual(row);
	const runs = ritual.runs.map((run) => ({
		...run,
		project,
		label: row.title,
		slug: row.slug,
		kind: "ritual",
		manual
	}));
	const cadence = cadenceText(row.cadence);
	const model = policy.model ?? "the profile's model";
	const { today } = useClock();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "page-head",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Crumbs, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: workspacePath(project),
				children: project
			}) }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "page-title page-title-sans",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TitleText, { text: row.title })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "page-meta meta-flow",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "rw-chips",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindWord, {
							kind: "ritual",
							manual,
							icon: true
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StateWord, { state: ritualWord(row, today) }),
					cadence === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: cadence }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
						className: "text-faint",
						children: row.slug
					})
				]
			}),
			manual ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "note-box",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
					row.mode === "off" ? "darius does not start this ritual (mode off)." : "darius does not start this ritual, because it is not active.",
					" You run it by hand; darius tracks the schedule. To let darius run it, give it a policy with",
					" ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("code", {
						className: "inline-code",
						children: [
							"darius ritual set ",
							row.slug,
							" --mode report ..."
						]
					}),
					"."
				] })
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "lede",
				children: `darius runs this ritual with ${model}, in ${policy.mode} mode: ${modeText(policy.mode)}.`
			}),
			row.skill === null && row.host === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "lede lede-tight",
				children: [
					row.skill === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
						"It follows the repo skill ",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
							className: "inline-code",
							children: row.skill
						}),
						"."
					] }),
					row.skill === null || row.host === null ? null : " ",
					row.host === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
						"Runs on ",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
							className: "inline-code",
							children: row.host
						}),
						" only; the timer of any other host skips it."
					] })
				]
			})
		]
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "board",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "board-main",
			children: [
				held === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: "Needs you",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "card card-accent edge-wait",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Questions, {
							project,
							run: held
						})
					})
				}),
				finished === null || asks.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: "Needs you",
					aside: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: runPath(project, finished.run),
						children: "Open the run"
					}),
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResultQuestions, {
						project,
						row: finished,
						questions: asks
					})
				}),
				next === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: "What happens next",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NextStepCard, { step: next })
				}),
				finished === null || report === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: "Latest report",
					aside: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: runPath(project, finished.run),
						children: "Read it all"
					}),
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: `card card-accent edge-${runState(finished).tone}`,
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Report, {
							report,
							lines: 4,
							fades: false
						}), finished.result === null || summaryTags(finished.result, finished.acknowledged !== null).length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "rw-chips mt-3",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResultChips, {
								summary: finished.result,
								isAnswered: finished.acknowledged !== null
							})
						})]
					})
				}),
				ritual.handoff === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: "Note for the next run",
					aside: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: runPath(project, ritual.handoff.run),
						children: "From this run"
					}),
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HandoffCard, { handoff: ritual.handoff })
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: "History",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "panel",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RunList, {
							runs,
							showProject: false,
							showLabel: false,
							empty: "This ritual has not run yet."
						})
					})
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("aside", {
			className: "board-rail",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
				title: "Rules and instructions",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "folds",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Fold, {
						summary: "Rules: what it may do, and what makes it stop and ask",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Facts, { facts: [
							{
								label: "May run",
								value: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chips, {
									items: policy.may,
									none: "only the read-only defaults"
								})
							},
							{
								label: "Stops at",
								value: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chips, {
									items: policy.hold,
									none: "nothing"
								})
							},
							{
								label: "Max turns",
								value: policy.maxTurns ?? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-muted",
									children: "default"
								})
							},
							{
								label: "Profile",
								value: policy.profile === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-muted",
									children: "default"
								}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
									to: `/profiles#profile-${policy.profile}`,
									children: policy.profile
								})
							},
							...policy.notes === null ? [] : [{
								label: "Notes",
								value: policy.notes
							}]
						] })
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Fold, {
						summary: "Instructions",
						open: manual,
						children: ritual.body.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "No instructions." }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Markdown, { blocks: ritual.body })
					})]
				})
			})
		})]
	})] });
});
//#endregion
//#region app/routes/run.tsx
var run_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => run_default,
	loader: () => loader$1,
	meta: () => meta$1
});
function loader$1({ context, params }) {
	const run = context.run(params.project, params.run);
	if (run === null) throw data(`No run ${params.run} in project ${params.project}.`, { status: 404 });
	const status = statusOf(context);
	const project = status.projects.find((candidate) => candidate.name === run.project);
	const failure = runFailure(run.project, run.row, status.utcOffset);
	const next = failure === null ? null : nextStep(failure, {
		today: status.today,
		offset: status.utcOffset
	});
	const ritual = project?.rituals.find((candidate) => `ritual/${candidate.slug}` === run.row.item);
	return {
		run,
		kind: itemKind(run.row.item),
		manual: itemManual(run.row.item, ritual),
		label: itemLabel(project, run.row.item),
		stuck: stuckFor(run.row, status.generatedAt),
		next
	};
}
var meta$1 = ({ data: loaded, params }) => [{ title: `${loaded?.label ?? "Run"} · ${params.project} | darius` }];
var run_default = withComponentProps(function Run({ loaderData }) {
	const { run, kind, manual, label, stuck, next } = loaderData;
	const { row, project } = run;
	const state = stuck === null ? runState(row) : {
		tone: "late",
		label: "May be stuck"
	};
	const headline = row.phase === "closed" && row.outcome === "complete" ? excerpt(run.findings)?.headline ?? null : null;
	const body = headline === null || run.findings === null ? run.findings : run.findings.slice(1);
	const title = headline ?? label;
	const took = row.endedAt === null ? null : duration(row.startedAt, row.endedAt);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "page-head",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Crumbs, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: workspacePath(project),
				children: project
			}), title === label ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				"aria-hidden": "true",
				children: " / "
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: itemPath(project, row.item),
				children: label
			})] })] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "page-title page-title-run",
				children: title === label ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: itemPath(project, row.item),
					className: "title-link",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TitleText, { text: label })
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TitleText, { text: title })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "page-meta meta-flow",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "rw-chips",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KindWord, {
							kind,
							manual,
							icon: true
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StateWord, { state }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["started ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Time, { iso: row.startedAt })] }),
					took === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["took ", took] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.who === "timer" ? "by timer" : `by ${row.who}` })
				]
			}),
			stuck === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "page-warn tone-late",
				children: stuckText(stuck)
			})
		]
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "board",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "board-main",
			children: [
				row.phase === "held" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: "Needs you",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "card card-accent edge-wait",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Questions, {
							project,
							run: row
						})
					})
				}) : null,
				next === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: "What happens next",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NextStepCard, { step: next })
				}),
				run.result === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResultPanel, {
					project,
					row,
					result: run.result
				}),
				body !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: "Report",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "measure",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Markdown, { blocks: body })
					})
				}) : row.phase === "closed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
					title: "Report",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "This run left no report." })
				}) : null
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("aside", {
			className: "board-rail",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
				title: "Run details",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "panel panel-pad",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Facts, { facts: [
						{
							label: "Run",
							value: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
								className: "break-all",
								children: row.run
							})
						},
						{
							label: "Item",
							value: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: row.item })
						},
						{
							label: "Ended",
							value: row.endedAt === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "text-muted",
								children: "not yet"
							}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Time, { iso: row.endedAt })
						}
					] }), run.events.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
						className: "timeline",
						children: run.events.map((event, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "flex flex-wrap items-baseline gap-x-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
								className: "text-gold-hi",
								children: event.type
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "text-sm text-muted",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Time, { iso: event.at }),
									", ",
									event.who
								]
							})]
						}), event.detail === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-0.5 break-words",
							children: event.detail
						})] }, `${index}`))
					})]
				})
			})
		})]
	})] });
});
//#endregion
//#region app/routes/not-found.tsx
var not_found_exports = /* @__PURE__ */ __exportAll({
	ErrorBoundary: () => RouteError,
	default: () => not_found_default,
	loader: () => loader,
	meta: () => meta
});
function loader() {
	throw data("No page lives at this address.", { status: 404 });
}
var meta = () => [{ title: "Not found | darius" }];
var not_found_default = withComponentProps(function NotFound() {
	return null;
});
//#endregion
//#region \0virtual:react-router/server-manifest
var server_manifest_default = {
	"entry": {
		"module": "/assets/entry.client-CmCwoJDN.js",
		"imports": ["/assets/chunk-OB3PAWPO-Dkr90-oZ.js", "/assets/jsx-runtime-Bpruz7Fm.js"],
		"css": []
	},
	"routes": {
		"root": {
			"id": "root",
			"parentId": void 0,
			"path": "",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/root-DDvd9ptu.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/kind-CbYiwFqF.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/view-WeMGZXf2.js",
				"/assets/agenda-6SwlNSJ1.js",
				"/assets/settings-YoGy02pU.js"
			],
			"css": ["/assets/root-DX4DWVkf.css"],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/overview": {
			"id": "routes/overview",
			"parentId": "root",
			"path": void 0,
			"index": true,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/overview-D2Qdd8jy.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/runs-4rfjFtz-.js",
				"/assets/pulse-B4EWshjY.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/kind-CbYiwFqF.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/chip-DMBwRjCd.js",
				"/assets/view-WeMGZXf2.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"overview-all": {
			"id": "overview-all",
			"parentId": "root",
			"path": "all",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/overview-D2Qdd8jy.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/runs-4rfjFtz-.js",
				"/assets/pulse-B4EWshjY.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/kind-CbYiwFqF.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/chip-DMBwRjCd.js",
				"/assets/view-WeMGZXf2.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"overview-workspace": {
			"id": "overview-workspace",
			"parentId": "root",
			"path": "w/:ws",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/overview-D2Qdd8jy.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/runs-4rfjFtz-.js",
				"/assets/pulse-B4EWshjY.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/kind-CbYiwFqF.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/chip-DMBwRjCd.js",
				"/assets/view-WeMGZXf2.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"vigils-all": {
			"id": "vigils-all",
			"parentId": "root",
			"path": "vigils",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/vigils-CLgRpaTa.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/chip-DMBwRjCd.js",
				"/assets/view-WeMGZXf2.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/section-DsT-EnCP.js",
				"/assets/kind-CbYiwFqF.js",
				"/assets/agenda-6SwlNSJ1.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"vigils-workspace": {
			"id": "vigils-workspace",
			"parentId": "root",
			"path": "w/:ws/vigils",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/vigils-CLgRpaTa.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/chip-DMBwRjCd.js",
				"/assets/view-WeMGZXf2.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/section-DsT-EnCP.js",
				"/assets/kind-CbYiwFqF.js",
				"/assets/agenda-6SwlNSJ1.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"rituals-all": {
			"id": "rituals-all",
			"parentId": "root",
			"path": "rituals",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/rituals-DjneIVff.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/runs-4rfjFtz-.js",
				"/assets/pulse-B4EWshjY.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/section-DsT-EnCP.js",
				"/assets/kind-CbYiwFqF.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/chip-DMBwRjCd.js",
				"/assets/view-WeMGZXf2.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/agenda-6SwlNSJ1.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"rituals-workspace": {
			"id": "rituals-workspace",
			"parentId": "root",
			"path": "w/:ws/rituals",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/rituals-DjneIVff.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/runs-4rfjFtz-.js",
				"/assets/pulse-B4EWshjY.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/section-DsT-EnCP.js",
				"/assets/kind-CbYiwFqF.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/chip-DMBwRjCd.js",
				"/assets/view-WeMGZXf2.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/agenda-6SwlNSJ1.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"milestones-all": {
			"id": "milestones-all",
			"parentId": "root",
			"path": "milestones",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/milestones-BzFRODH4.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/milestones-fehpKv1x.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/kind-CbYiwFqF.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"milestones-workspace": {
			"id": "milestones-workspace",
			"parentId": "root",
			"path": "w/:ws/milestones",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/milestones-BzFRODH4.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/milestones-fehpKv1x.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/kind-CbYiwFqF.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/milestone": {
			"id": "routes/milestone",
			"parentId": "root",
			"path": "w/:ws/milestones/:milestone",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/milestone-Bzn8Pfh1.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/pulse-B4EWshjY.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/milestones-fehpKv1x.js",
				"/assets/kind-CbYiwFqF.js",
				"/assets/chip-DMBwRjCd.js",
				"/assets/view-WeMGZXf2.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/settings": {
			"id": "routes/settings",
			"parentId": "root",
			"path": "settings",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": false,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/settings-GO9-To-Y.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/route-error-DMMzp2qt.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/settings-general": {
			"id": "routes/settings-general",
			"parentId": "routes/settings",
			"path": void 0,
			"index": true,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/settings-general-yuxcxw_3.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/settings-YoGy02pU.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/clock-BleYDEHk.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/settings-notifications": {
			"id": "routes/settings-notifications",
			"parentId": "routes/settings",
			"path": "notifications",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": false,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/settings-notifications-BVfp58JE.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/clock-BleYDEHk.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/settings-backups": {
			"id": "routes/settings-backups",
			"parentId": "routes/settings",
			"path": "backups",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/settings-backups-BuG8a5nu.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/route-error-DMMzp2qt.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/settings-about": {
			"id": "routes/settings-about",
			"parentId": "routes/settings",
			"path": "about",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/settings-about-BloEGvzK.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/clock-BleYDEHk.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/status": {
			"id": "routes/status",
			"parentId": "root",
			"path": "status",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/status-BqojWBM-.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/route-error-DMMzp2qt.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/runs": {
			"id": "routes/runs",
			"parentId": "root",
			"path": "runs",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/runs-DEuY8C6_.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/runs-4rfjFtz-.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/kind-CbYiwFqF.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/chip-DMBwRjCd.js",
				"/assets/view-WeMGZXf2.js",
				"/assets/pulse-B4EWshjY.js",
				"/assets/row-CzI7mG7X.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/legacy-run": {
			"id": "routes/legacy-run",
			"parentId": "root",
			"path": "runs/:project/:run",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": false,
			"hasErrorBoundary": false,
			"module": "/assets/legacy-run-BvRk9kiK.js",
			"imports": [],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/profiles": {
			"id": "routes/profiles",
			"parentId": "root",
			"path": "profiles",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/profiles-DZkfJUqB.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/clock-BleYDEHk.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/project": {
			"id": "routes/project",
			"parentId": "root",
			"path": "p/:project",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": false,
			"module": "/assets/project-TxTyGX1W.js",
			"imports": ["/assets/chunk-OB3PAWPO-Dkr90-oZ.js"],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/ritual": {
			"id": "routes/ritual",
			"parentId": "root",
			"path": "p/:project/rituals/:slug",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/ritual-ByVjolko.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/chip-DMBwRjCd.js",
				"/assets/view-WeMGZXf2.js",
				"/assets/runs-4rfjFtz-.js",
				"/assets/pulse-B4EWshjY.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/kind-CbYiwFqF.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/run": {
			"id": "routes/run",
			"parentId": "root",
			"path": "p/:project/runs/:run",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/run-DQc2Wy1b.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/jsx-runtime-Bpruz7Fm.js",
				"/assets/clock-BleYDEHk.js",
				"/assets/chip-DMBwRjCd.js",
				"/assets/view-WeMGZXf2.js",
				"/assets/runs-4rfjFtz-.js",
				"/assets/pulse-B4EWshjY.js",
				"/assets/ui-DRNhXSeL.js",
				"/assets/row-CzI7mG7X.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/kind-CbYiwFqF.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		},
		"routes/not-found": {
			"id": "routes/not-found",
			"parentId": "root",
			"path": "*",
			"index": void 0,
			"caseSensitive": void 0,
			"hasAction": false,
			"hasLoader": true,
			"hasClientAction": false,
			"hasClientLoader": false,
			"hasClientMiddleware": false,
			"hasDefaultExport": true,
			"hasErrorBoundary": true,
			"module": "/assets/not-found-BReV_nV-.js",
			"imports": [
				"/assets/chunk-OB3PAWPO-Dkr90-oZ.js",
				"/assets/route-error-DMMzp2qt.js",
				"/assets/jsx-runtime-Bpruz7Fm.js"
			],
			"css": [],
			"clientActionModule": void 0,
			"clientLoaderModule": void 0,
			"clientMiddlewareModule": void 0,
			"hydrateFallbackModule": void 0
		}
	},
	"url": "/assets/manifest-8501690e.js",
	"version": "8501690e",
	"sri": void 0
};
//#endregion
//#region \0virtual:react-router/server-build
var assetsBuildDirectory = "build/client";
var basename = "/";
var future = {
	"unstable_optimizeDeps": false,
	"v8_passThroughRequests": false,
	"v8_trailingSlashAwareDataRequests": false,
	"unstable_previewServerPrerendering": false,
	"v8_middleware": false,
	"v8_splitRouteModules": false,
	"v8_viteEnvironmentApi": false
};
var ssr = true;
var isSpaMode = false;
var prerender = [];
var routeDiscovery = {
	"mode": "lazy",
	"manifestPath": "/__manifest"
};
var publicPath = "/";
var entry = { module: entry_server_exports };
var routes = {
	"root": {
		id: "root",
		parentId: void 0,
		path: "",
		index: void 0,
		caseSensitive: void 0,
		module: root_exports
	},
	"routes/overview": {
		id: "routes/overview",
		parentId: "root",
		path: void 0,
		index: true,
		caseSensitive: void 0,
		module: overview_exports
	},
	"overview-all": {
		id: "overview-all",
		parentId: "root",
		path: "all",
		index: void 0,
		caseSensitive: void 0,
		module: overview_exports
	},
	"overview-workspace": {
		id: "overview-workspace",
		parentId: "root",
		path: "w/:ws",
		index: void 0,
		caseSensitive: void 0,
		module: overview_exports
	},
	"vigils-all": {
		id: "vigils-all",
		parentId: "root",
		path: "vigils",
		index: void 0,
		caseSensitive: void 0,
		module: vigils_exports
	},
	"vigils-workspace": {
		id: "vigils-workspace",
		parentId: "root",
		path: "w/:ws/vigils",
		index: void 0,
		caseSensitive: void 0,
		module: vigils_exports
	},
	"rituals-all": {
		id: "rituals-all",
		parentId: "root",
		path: "rituals",
		index: void 0,
		caseSensitive: void 0,
		module: rituals_exports
	},
	"rituals-workspace": {
		id: "rituals-workspace",
		parentId: "root",
		path: "w/:ws/rituals",
		index: void 0,
		caseSensitive: void 0,
		module: rituals_exports
	},
	"milestones-all": {
		id: "milestones-all",
		parentId: "root",
		path: "milestones",
		index: void 0,
		caseSensitive: void 0,
		module: milestones_exports
	},
	"milestones-workspace": {
		id: "milestones-workspace",
		parentId: "root",
		path: "w/:ws/milestones",
		index: void 0,
		caseSensitive: void 0,
		module: milestones_exports
	},
	"routes/milestone": {
		id: "routes/milestone",
		parentId: "root",
		path: "w/:ws/milestones/:milestone",
		index: void 0,
		caseSensitive: void 0,
		module: milestone_exports
	},
	"routes/settings": {
		id: "routes/settings",
		parentId: "root",
		path: "settings",
		index: void 0,
		caseSensitive: void 0,
		module: settings_exports
	},
	"routes/settings-general": {
		id: "routes/settings-general",
		parentId: "routes/settings",
		path: void 0,
		index: true,
		caseSensitive: void 0,
		module: settings_general_exports
	},
	"routes/settings-notifications": {
		id: "routes/settings-notifications",
		parentId: "routes/settings",
		path: "notifications",
		index: void 0,
		caseSensitive: void 0,
		module: settings_notifications_exports
	},
	"routes/settings-backups": {
		id: "routes/settings-backups",
		parentId: "routes/settings",
		path: "backups",
		index: void 0,
		caseSensitive: void 0,
		module: settings_backups_exports
	},
	"routes/settings-about": {
		id: "routes/settings-about",
		parentId: "routes/settings",
		path: "about",
		index: void 0,
		caseSensitive: void 0,
		module: settings_about_exports
	},
	"routes/status": {
		id: "routes/status",
		parentId: "root",
		path: "status",
		index: void 0,
		caseSensitive: void 0,
		module: status_exports
	},
	"routes/runs": {
		id: "routes/runs",
		parentId: "root",
		path: "runs",
		index: void 0,
		caseSensitive: void 0,
		module: runs_exports
	},
	"routes/legacy-run": {
		id: "routes/legacy-run",
		parentId: "root",
		path: "runs/:project/:run",
		index: void 0,
		caseSensitive: void 0,
		module: legacy_run_exports
	},
	"routes/profiles": {
		id: "routes/profiles",
		parentId: "root",
		path: "profiles",
		index: void 0,
		caseSensitive: void 0,
		module: profiles_exports
	},
	"routes/project": {
		id: "routes/project",
		parentId: "root",
		path: "p/:project",
		index: void 0,
		caseSensitive: void 0,
		module: project_exports
	},
	"routes/ritual": {
		id: "routes/ritual",
		parentId: "root",
		path: "p/:project/rituals/:slug",
		index: void 0,
		caseSensitive: void 0,
		module: ritual_exports
	},
	"routes/run": {
		id: "routes/run",
		parentId: "root",
		path: "p/:project/runs/:run",
		index: void 0,
		caseSensitive: void 0,
		module: run_exports
	},
	"routes/not-found": {
		id: "routes/not-found",
		parentId: "root",
		path: "*",
		index: void 0,
		caseSensitive: void 0,
		module: not_found_exports
	}
};
var allowedActionOrigins = false;
//#endregion
export { allowedActionOrigins, server_manifest_default as assets, assetsBuildDirectory, basename, entry, future, isSpaMode, prerender, publicPath, routeDiscovery, routes, ssr };
