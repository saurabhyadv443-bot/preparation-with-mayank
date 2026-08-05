/*
 * auth.js
 * Quiz Portal authentication helper
 * - Disables authentication gating and preserves logout behavior
 * - Adds a splash redirect for index.html only
 */
(function(){
    function login(){
        return true;
    }

    function logout(){
        try{ window.location.href = 'index.html'; }catch(e){}
    }

    function changePassword(){
        return { success:false, message:'Password management is disabled.' };
    }

    function protectPage(){
        return true;
    }

    function attachLogoutHandler(){
        document.addEventListener('DOMContentLoaded', ()=>{
            const el = document.getElementById('logoutBtn');
            if(el){ el.addEventListener('click', (ev)=>{ ev.preventDefault(); logout(); }); }
        });
    }

    if(location.pathname === '/' || location.pathname.endsWith('/index.html')){
        window.setTimeout(function(){
            window.location.href = 'dashboard.html';
        }, 10000);
    }

    const authAPI = {
        login,
        logout,
        changePassword,
        protectPage
    };

    window.auth = authAPI;
    window.__quizAuth = authAPI;

    attachLogoutHandler();
})();

