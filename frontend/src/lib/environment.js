export const isPreview = () => new URLSearchParams(window.location.search).get('preview') === '1';
export const isRenewal = () => window.location.pathname.endsWith('/renewal.html');
export const isInquiry = () => window.location.pathname.endsWith('/inquiry.html');
export const previewSeedId = () => isInquiry() ? 'inquiry-seed' : isRenewal() ? 'renewal-seed' : 'preview-shared-desk';
