// ==UserScript==
// @name         YouTube - Hide Watched Videos
// @namespace    https://tampermonkey.net/
// @version      1.2.0
// @description  YouTube 피드에서 시청한 동영상 숨기기
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    // ============================================================
    // 설정
    // ============================================================
    const WATCHED_THRESHOLD = 15;

    // ============================================================
    // CSS
    // ============================================================
    const style = document.createElement('style');
    style.textContent = `
        [data-tm-watched-hidden="true"] {
            display: none !important;
        }
    `;
    document.documentElement.appendChild(style);

    // ============================================================
    // 영상 컨테이너 셀렉터
    // ============================================================
    const VIDEO_SELECTORS = [
        'ytd-rich-item-renderer',
        'ytd-video-renderer',
        'ytd-grid-video-renderer',
        'ytd-playlist-video-renderer',
        'yt-lockup-view-model'
    ].join(',');

    // progress bar 관련 셀렉터 (나중에 붙는 경우 감지용)
    const PROGRESS_SELECTORS = [
        '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
        '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern',
        '#progress',
        'yt-thumbnail-overlay-progress-bar-view-model',
        'ytd-thumbnail-overlay-resume-playback-renderer'
    ].join(',');

    // ============================================================
    // 시청률 확인
    // ============================================================
    function getWatchProgress(container) {
        const progressElements = container.querySelectorAll(
            '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment, ' +
            '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegmentModern, ' +
            '#progress'
        );

        let maxProgress = 0;

        for (const el of progressElements) {
            // 1. inline style의 width: N% 우선
            const styleAttr = el.getAttribute('style') || '';
            const match = styleAttr.match(/width\s*:\s*([\d.]+)%/i);
            if (match) {
                const p = parseFloat(match[1]);
                if (!Number.isNaN(p)) {
                    maxProgress = Math.max(maxProgress, p);
                    continue;
                }
            }

            // 2. style 속성이 없으면 computed width로 계산
            const computed = getComputedStyle(el);
            const width = parseFloat(computed.width);
            const parent = el.parentElement;
            if (parent && width > 0 && parent.clientWidth > 0) {
                const p = (width / parent.clientWidth) * 100;
                maxProgress = Math.max(maxProgress, p);
            }
        }

        return maxProgress;
    }

    // ============================================================
    // 영상 하나 검사 (이미 검사한 건 절대 다시 안 함)
    // ============================================================
    function processVideo(container) {
        if (!container || container.dataset.tmWatchedChecked === 'true') {
            return;
        }

        const progress = getWatchProgress(container);

        // 검사 완료 표시 (progress가 있든 없든 한 번만 검사)
        container.dataset.tmWatchedChecked = 'true';

        if (progress >= WATCHED_THRESHOLD) {
            container.dataset.tmWatchedHidden = 'true';
        }
    }

    // ============================================================
    // 노드 처리
    // ============================================================
    function processNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        // 1. 새로 추가된 노드 자체가 영상 컨테이너인 경우
        if (node.matches?.(VIDEO_SELECTORS)) {
            processVideo(node);
        }

        // 2. 새로 추가된 노드 안에 영상 컨테이너가 있는 경우
        const containers = node.querySelectorAll?.(VIDEO_SELECTORS);
        if (containers) {
            containers.forEach(processVideo);
        }

        // 3. 중요: progress bar가 나중에 붙는 경우
        //    → 가장 가까운 상위 영상 컨테이너를 찾아서 검사
        if (node.matches?.(PROGRESS_SELECTORS) || node.querySelector?.(PROGRESS_SELECTORS)) {
            const parentVideo = node.closest?.(VIDEO_SELECTORS);
            if (parentVideo) {
                processVideo(parentVideo);
            }
        }
    }

    // ============================================================
    // MutationObserver (debounce)
    // ============================================================
    let scheduled = false;
    const pendingNodes = new Set();

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (mutation.type !== 'childList') continue;
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    pendingNodes.add(node);
                }
            }
        }

        if (!scheduled && pendingNodes.size > 0) {
            scheduled = true;
            requestAnimationFrame(() => {
                pendingNodes.forEach(processNode);
                pendingNodes.clear();
                scheduled = false;
            });
        }
    });

    // ============================================================
    // 시작
    // ============================================================
    function start() {
        if (!document.body) {
            requestAnimationFrame(start);
            return;
        }

        // 이미 존재하는 영상들 검사
        document.querySelectorAll(VIDEO_SELECTORS).forEach(processVideo);

        // 이후 추가되는 노드 감시
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();