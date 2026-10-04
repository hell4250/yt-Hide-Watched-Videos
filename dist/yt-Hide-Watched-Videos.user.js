// ==UserScript==
// @name         YouTube - Hide Watched Videos
// @namespace    https://tampermonkey.net/
// @version      2.1.0
// @description  유튜브 피드에서 시청한 동영상 숨기기
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    // ============================================================
    // 설정
    // ============================================================
    const CONFIG = Object.freeze({
        WATCHED_THRESHOLD: 15,           // 시청 기준 (%)
        ATTR_HIDDEN: 'data-tm-watched-hidden',
        CHANNEL_MIN_WIDTH: '3em'         // 채널명이 줄어들 수 있는 최소 폭
    });

    // 최상위 피드 셀 (여백까지 함께 숨기기 위해 lockup보다 우선 탐색)
    const OUTER_CONTAINER_SELECTORS = [
        'ytd-rich-item-renderer',        // 홈 피드
        'ytd-compact-video-renderer',    // 시청 페이지 사이드바
        'ytd-video-renderer',            // 검색 결과 / 채널 피드
        'ytd-grid-video-renderer',       // 그리드 목록
        'ytd-playlist-video-renderer'    // 재생목록
    ].join(',');

    const LOCKUP_SELECTOR = 'yt-lockup-view-model';

    const PROGRESS_SELECTORS = [
        '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
        '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern',
        '#progress',
        'yt-thumbnail-overlay-progress-bar-view-model',
        'ytd-thumbnail-overlay-resume-playback-renderer'
    ].join(',');

    const SEARCH_TARGET_SELECTORS = `${OUTER_CONTAINER_SELECTORS},${LOCKUP_SELECTOR},${PROGRESS_SELECTORS}`;

    // 메타데이터 행: [채널명] • [아이콘] [조회수] • [업로드 시간]
    const METADATA_ROW = `${LOCKUP_SELECTOR} .ytContentMetadataViewModelMetadataRow`;
    const CHANNEL_TEXT = `${METADATA_ROW} > .ytContentMetadataViewModelMetadataText:first-child`;

    // ============================================================
    // CSS 주입
    // ============================================================
    const style = document.createElement('style');
    style.textContent = `
        [${CONFIG.ATTR_HIDDEN}="true"] { display: none !important; }

        /* 줄바꿈 금지: 넘치는 뒷열이 2행으로 밀려 잘리는 것을 방지 */
        ${METADATA_ROW} { display: flex; flex-wrap: nowrap; min-width: 0; }
        ${METADATA_ROW} > * { flex: none; white-space: nowrap; }

        /* 채널명만 남는 공간에 맞춰 줄어들고 말줄임(...) 처리 */
        ${CHANNEL_TEXT} {
            flex: 0 1 auto;
            min-width: ${CONFIG.CHANNEL_MIN_WIDTH};
            overflow: hidden;
            text-overflow: ellipsis;
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    // ============================================================
    // 컨테이너 / 시청률
    // ============================================================
    const getVideoContainer = node =>
        node.closest(OUTER_CONTAINER_SELECTORS) || node.closest(LOCKUP_SELECTOR);

    function getWatchProgress(container) {
        let maxProgress = 0;

        for (const el of container.querySelectorAll(PROGRESS_SELECTORS)) {
            // 인라인 style (리플로우 없음)
            const inlineWidth = el.style.width;
            let value = inlineWidth.endsWith('%') ? parseFloat(inlineWidth) : NaN;

            // 인라인 값이 없을 때만 레이아웃 계산으로 대체
            if (Number.isNaN(value)) {
                const parentWidth = el.parentElement?.clientWidth;
                if (!parentWidth) continue;
                value = (el.offsetWidth / parentWidth) * 100;
            }

            maxProgress = Math.max(maxProgress, value);
        }

        return maxProgress;
    }

    function processVideo(container) {
        if (container.hasAttribute(CONFIG.ATTR_HIDDEN)) return;
        if (getWatchProgress(container) >= CONFIG.WATCHED_THRESHOLD) {
            container.setAttribute(CONFIG.ATTR_HIDDEN, 'true');
        }
    }

    const processNode = node => {
        const container = getVideoContainer(node);
        if (container) processVideo(container);
    };

    // ============================================================
    // MutationObserver 배치 처리
    // ============================================================
    const pendingNodes = new Set();
    let isScheduled = false;

    function flush() {
        pendingNodes.forEach(processNode);
        pendingNodes.clear();
        isScheduled = false;
    }

    function collectTargets(node) {
        pendingNodes.add(node);
        node.querySelectorAll(SEARCH_TARGET_SELECTORS).forEach(el => pendingNodes.add(el));
    }

    const observer = new MutationObserver(mutations => {
        for (const { addedNodes } of mutations) {
            for (const node of addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) collectTargets(node);
            }
        }

        if (pendingNodes.size > 0 && !isScheduled) {
            isScheduled = true;
            requestAnimationFrame(flush);
        }
    });

    // ============================================================
    // 잘린 채널명 툴팁 (마우스 오버 시 1회만 설정)
    // ============================================================
    function setupChannelTooltip() {
        document.addEventListener('mouseover', e => {
            const el = e.target.closest?.(CHANNEL_TEXT);
            if (el && !el.title && el.scrollWidth > el.clientWidth) {
                el.title = el.textContent.trim();
            }
        }, { passive: true });
    }

    // ============================================================
    // 초기화
    // ============================================================
    function init() {
        const start = () => {
            document.querySelectorAll(SEARCH_TARGET_SELECTORS).forEach(processNode);
            observer.observe(document.body, { childList: true, subtree: true });
        };

        setupChannelTooltip();

        if (document.body) {
            start();
        } else {
            document.addEventListener('DOMContentLoaded', start, { once: true });
        }
    }

    init();
})();