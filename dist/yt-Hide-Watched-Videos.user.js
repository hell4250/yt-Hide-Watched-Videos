// ==UserScript==
// @name         YouTube - Hide Watched Videos
// @namespace    https://tampermonkey.net/
// @version      1.3.0
// @description  YouTube 피드에서 시청한 동영상 숨기기
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    // ============================================================
    // 설정 및 셀렉터
    // ============================================================
    const CONFIG = Object.freeze({
        WATCHED_THRESHOLD: 15, // 시청 기준 (%)
        ATTR_CHECKED: 'data-tm-watched-checked',
        ATTR_HIDDEN: 'data-tm-watched-hidden',
    });

    const VIDEO_SELECTORS = [
        'ytd-rich-item-renderer',
        'ytd-video-renderer',
        'ytd-grid-video-renderer',
        'ytd-playlist-video-renderer',
        'yt-lockup-view-model'
    ].join(',');

    const PROGRESS_SELECTORS = [
        '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
        '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern',
        '#progress',
        'yt-thumbnail-overlay-progress-bar-view-model',
        'ytd-thumbnail-overlay-resume-playback-renderer'
    ].join(',');

    // ============================================================
    // 스타일 주입
    // ============================================================
    function injectStyle() {
        const style = document.createElement('style');
        style.textContent = `[${CONFIG.ATTR_HIDDEN}="true"] { display: none !important; }`;
        (document.head || document.documentElement).appendChild(style);
    }

    // ============================================================
    // 시청률 계산 (레이아웃 리플로우 방지)
    // ============================================================
    function getWatchProgressInfo(container) {
        const progressElements = container.querySelectorAll(PROGRESS_SELECTORS);
        if (progressElements.length === 0) {
            return { progress: 0, hasProgressBar: false };
        }

        let maxProgress = 0;

        for (let i = 0; i < progressElements.length; i++) {
            const el = progressElements[i];

            // 1. style.width 또는 인라인 스타일 문자열 직접 파싱 (리플로우 발생 안 함)
            const styleWidth = el.style.width;
            if (styleWidth && styleWidth.endsWith('%')) {
                const p = parseFloat(styleWidth);
                if (!Number.isNaN(p)) {
                    maxProgress = Math.max(maxProgress, p);
                    continue;
                }
            }

            const styleAttr = el.getAttribute('style');
            if (styleAttr) {
                const match = styleAttr.match(/width\s*:\s*([\d.]+)%/i);
                if (match) {
                    const p = parseFloat(match[1]);
                    if (!Number.isNaN(p)) {
                        maxProgress = Math.max(maxProgress, p);
                        continue;
                    }
                }
            }

            // 2. 인라인 스타일이 없는 경우 fallback 계산 (강제 레이아웃 계산 발생)
            const parent = el.parentElement;
            if (parent && parent.clientWidth > 0) {
                const width = el.offsetWidth;
                if (width > 0) {
                    const p = (width / parent.clientWidth) * 100;
                    maxProgress = Math.max(maxProgress, p);
                }
            }
        }

        return { progress: maxProgress, hasProgressBar: true };
    }

    // ============================================================
    // 영상 카드 검사 및 숨김 처리
    // ============================================================
    function processVideo(container) {
        if (!container || container.getAttribute(CONFIG.ATTR_CHECKED) === 'true') {
            return;
        }

        const { progress, hasProgressBar } = getWatchProgressInfo(container);

        // 프로그래스 바 요소가 실제 존재할 때만 검사 완료 플래그 설정
        // (지연 로딩으로 프로그래스 바가 늦게 생성되는 경우 대응)
        if (hasProgressBar) {
            container.setAttribute(CONFIG.ATTR_CHECKED, 'true');
        }

        if (progress >= CONFIG.WATCHED_THRESHOLD) {
            container.setAttribute(CONFIG.ATTR_HIDDEN, 'true');
            container.setAttribute(CONFIG.ATTR_CHECKED, 'true');
        }
    }

    // ============================================================
    // MutationObserver 배치 처리 및 노드 수집
    // ============================================================
    const pendingNodes = new Set();
    let isScheduled = false;

    function flushPendingNodes() {
        const targetContainers = new Set();

        for (const node of pendingNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            // 1. 추가된 노드가 영상 카드인 경우
            if (node.matches(VIDEO_SELECTORS)) {
                targetContainers.add(node);
            } else {
                const children = node.querySelectorAll(VIDEO_SELECTORS);
                for (let i = 0; i < children.length; i++) {
                    targetContainers.add(children[i]);
                }
            }

            // 2. 추가된 노드가 뒤늦게 주입된 프로그래스 바인 경우
            if (node.matches(PROGRESS_SELECTORS)) {
                const parent = node.closest(VIDEO_SELECTORS);
                if (parent) targetContainers.add(parent);
            } else {
                const progressChildren = node.querySelectorAll(PROGRESS_SELECTORS);
                for (let i = 0; i < progressChildren.length; i++) {
                    const parent = progressChildren[i].closest(VIDEO_SELECTORS);
                    if (parent) targetContainers.add(parent);
                }
            }
        }

        pendingNodes.clear();
        isScheduled = false;

        for (const container of targetContainers) {
            processVideo(container);
        }
    }

    const observer = new MutationObserver(mutations => {
        let hasAddedNodes = false;

        for (let i = 0; i < mutations.length; i++) {
            const addedNodes = mutations[i].addedNodes;
            for (let j = 0; j < addedNodes.length; j++) {
                const node = addedNodes[j];
                if (node.nodeType === Node.ELEMENT_NODE) {
                    pendingNodes.add(node);
                    hasAddedNodes = true;
                }
            }
        }

        if (hasAddedNodes && !isScheduled) {
            isScheduled = true;
            requestAnimationFrame(flushPendingNodes);
        }
    });

    // ============================================================
    // 초기화 및 실행
    // ============================================================
    function init() {
        injectStyle();

        const startObserving = () => {
            const existingVideos = document.querySelectorAll(VIDEO_SELECTORS);
            for (let i = 0; i < existingVideos.length; i++) {
                processVideo(existingVideos[i]);
            }

            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        };

        if (document.body) {
            startObserving();
        } else {
            document.addEventListener('DOMContentLoaded', startObserving, { once: true });
        }
    }

    init();
})();