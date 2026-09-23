import React from 'react';
const paths={
 menu:<><path d="M4 6h16M4 12h16M4 18h16"/></>,
 plus:<path d="M12 5v14M5 12h14"/>,
 close:<path d="m6 6 12 12M6 18 18 6"/>,
 arrow:<path d="M12 19V5m-5 5 5-5 5 5"/>,
 stop:<rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>,
 edit:<><path d="m5 16-1 4 4-1L19 8l-3-3L5 16Zm9-9 3 3M12 20h8"/></>,
 return:<path d="M19 6v8H5m5-5-5 5 5 5"/>,
 copy:<><path d="M9 8h11v13H9zM15 4H4v13"/></>,
 download:<><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></>,
 chevron:<path d="m9 6 6 6-6 6"/>,
 info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.01"/></>,
 retry:<path d="M5 9a7 7 0 1 1-1 6M5 4v5h5"/>,
};
export default function Icon({name,...props}){return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>{paths[name]||paths.info}</svg>;}
