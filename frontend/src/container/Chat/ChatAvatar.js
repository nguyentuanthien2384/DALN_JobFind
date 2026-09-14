import React, { useState } from 'react';
export default function ChatAvatar({src,name,style,alt='',...props}) {
    const [failed,setFailed]=useState(null);
    if (src && failed !== src) return <img {...props} alt={alt} src={src} style={style} onError={()=>setFailed(src)} />;
    return <span aria-hidden="true" style={{...style,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0,background:'#fff0f5',color:'#b51648',fontWeight:600}}>{(name || '?').trim().slice(0,1).toUpperCase()}</span>;
}
