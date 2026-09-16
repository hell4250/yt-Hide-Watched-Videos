// ==UserScript==
// @name         YouTube - Hide Watched Videos
// @namespace    https://tampermonkey.net/
// @version      2.0.0
// @description  유튜브 홈 피드 및 사이드바 피드에서 시청한 동영상 숨기기
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    // ============================================================
    // 설정 및 상술
    // ============================================================
    const CONFIG = Object.freeze({
        WATCHED_THRESHOLD: 15, // 시청 기준 (%)
        ATTR_CHECKED: 'data-tm-watched-checked',
        ATTR_HIDDEN: 'data-tm-watched-hidden'
    });

    // 외각 레이아웃 컨테이너 (우선 순위 순서)
    // 홈 피드 여백 방지 및 사이드바 확장을 위한 최상위 셀렉터 정의
    const OUTER_CONTAINER_SELECTORS = [
        'ytd-rich-item-renderer',      // 홈 피드 그리드 아이템
        'ytd-compact-video-renderer',   // 재생 중 우측 사이드바 아이템
        'ytd-video-renderer',           // 검색 결과 / 채널 피드 아이템
        'ytd-grid-video-renderer',      // 그리드 목록 아이템
        'ytd-playlist-video-renderer'   // 재생목록 아이템
    ].join(',');

    const PROGRESS_SELECTORS = [
        '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
        '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern',
        '#progress',
        'yt-thumbnail-overlay-progress-bar-view-model',
        'ytd-thumbnail-overlay-resume-playback-renderer'
    ].join(',');

    const SEARCH_TARGET_SELECTORS = `${OUTER_CONTAINER_SELECTORS}, yt-lockup-view-model, ${PROGRESS_SELECTORS}`;

    // ============================================================
    // CSS 주입
    // ============================================================
    const style = document.createElement('style');
    style.textContent = `[${CONFIG.ATTR_HIDDEN}="true"] { display: none !important; }`;
    (document.head || document.documentElement).appendChild(style);

    // ============================================================
    // 컨테이너 추출 (홈 피드 여백 해결 및 확장성 보장)
    // ============================================================
    function getVideoContainer(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;

        // 1. 최상위 피드 셀(ytd-rich-item-renderer, ytd-compact-video-renderer 등) 탐색
        const outer = node.closest(OUTER_CONTAINER_SELECTORS);
        if (outer) return outer;

        // 2. 외각 레이아웃 요소가 없는 독립형 컴포넌트 Fallback
        return node.closest('yt-lockup-view-model');
    }

    // ============================================================
    // 시청률 계산 (Reflow 유발 최소화)
    // ============================================================
    function getWatchProgress(container) {
        const progressEls = container.querySelectorAll(PROGRESS_SELECTORS);
        if (progressEls.length === 0) {
            return { progress: 0, found: false };
        }

        let maxProgress = 0;

        for (let i = 0; i < progressEls.length; i++) {
            const el = progressEls[i];

            // 1. 인라인 style parsing (성능 최우선, 리플로우 방지)
            const styleWidth = el.style.width;
            if (styleWidth && styleWidth.endsWith('%')) {
                const val = parseFloat(styleWidth);
                if (!Number.isNaN(val)) {
                    maxProgress = Math.max(maxProgress, val);
                    continue;
                }
            }

            const styleAttr = el.getAttribute('style');
            if (styleAttr) {
                const match = styleAttr.match(/width\s*:\s*([\d.]+)%/i);
                if (match) {
                    const val = parseFloat(match[1]);
                    if (!Number.isNaN(val)) {
                        maxProgress = Math.max(maxProgress, val);
                        continue;
                    }
                }
            }

            // 2. 인라인 스타일 파싱 실패 시 계산 (Fallback)
            const parent = el.parentElement;
            if (parent && parent.clientWidth > 0) {
                const width = el.offsetWidth;
                if (width > 0) {
                    const val = (width / parent.clientWidth) * 100;
                    maxProgress = Math.max(maxProgress, val);
                }
            }
        }

        return { progress: maxProgress, found: true };
    }

    // ============================================================
    // 동영상 검사 및 숨김 처리
    // ============================================================
    function processVideo(container) {
        if (!container || container.getAttribute(CONFIG.ATTR_HIDDEN) === 'true') {
            return;
        }

        const { progress, found } = getWatchProgress(container);

        if (progress >= CONFIG.WATCHED_THRESHOLD) {
            container.setAttribute(CONFIG.ATTR_HIDDEN, 'true');
            container.setAttribute(CONFIG.ATTR_CHECKED, 'true');
            return;
        }

        // 프로그래스 바 노드가 실제 로드된 시점에만 검사 완료 처리
        if (found) {
            container.setAttribute(CONFIG.ATTR_CHECKED, 'true');
        }
    }

    // ============================================================
    // MutationObserver 배치 처리
    // ============================================================
    const pendingContainers = new Set();
    let isScheduled = false;

    function flush() {
        for (const container of pendingContainers) {
            processVideo(container);
        }
        pendingContainers.clear();
        isScheduled = false;
    }

    function collectTargets(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        // 노드 자신 확인
        const container = getVideoContainer(node);
        if (container) {
            pendingContainers.add(container);
        }

        // 하위 대상 탐색
        const descendants = node.querySelectorAll(SEARCH_TARGET_SELECTORS);
        for (let i = 0; i < descendants.length; i++) {
            const targetContainer = getVideoContainer(descendants[i]);
            if (targetContainer) {
                pendingContainers.add(targetContainer);
            }
        }
    }

    const observer = new MutationObserver(mutations => {
        let hasNew = false;

        for (let i = 0; i < mutations.length; i++) {
            const added = mutations[i].addedNodes;
            for (let j = 0; j < added.length; j++) {
                if (added[j].nodeType === Node.ELEMENT_NODE) {
                    collectTargets(added[j]);
                    hasNew = true;
                }
            }
        }

        if (hasNew && pendingContainers.size > 0 && !isScheduled) {
            isScheduled = true;
            requestAnimationFrame(flush);
        }
    });

    // ============================================================
    // 초기화
    // ============================================================
    function init() {
        const start = () => {
            const initialNodes = document.querySelectorAll(SEARCH_TARGET_SELECTORS);
            for (let i = 0; i < initialNodes.length; i++) {
                const container = getVideoContainer(initialNodes[i]);
                if (container) processVideo(container);
            }

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        };

        if (document.body) {
            start();
        } else {
            document.addEventListener('DOMContentLoaded', start, { once: true });
        }
    }

    init();
})();