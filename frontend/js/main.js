document.addEventListener('DOMContentLoaded',function(){
  // Smooth scroll for internal links
  document.querySelectorAll('a[href^="#"]').forEach(a=>{
    a.addEventListener('click',e=>{
      const href=a.getAttribute('href');
      if(href.length>1){
        e.preventDefault();
        const target=document.querySelector(href);
        if(target) target.scrollIntoView({behavior:'smooth',block:'start'});
      }
    });
  });

  // Waitlist form handling (frontend-only placeholder)
  const waitlistForm=document.getElementById('waitlistForm');
  if(waitlistForm){
    waitlistForm.addEventListener('submit',async function(e){
      e.preventDefault();
      const email=document.getElementById('email').value.trim();
      const wallet=document.getElementById('wallet').value.trim();
      const emailRe=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;
      if(!emailRe.test(email)){
        alert('Please enter a valid email address.');
        return;
      }
      // Store locally as placeholder for backend integration
      try{
        const payload={email,wallet,ts:new Date().toISOString()};
        const list=JSON.parse(localStorage.getItem('nexxore_waitlist')||'[]');
        list.push(payload);
        localStorage.setItem('nexxore_waitlist',JSON.stringify(list));
        waitlistForm.innerHTML='<div class="success"><h3>Thanks — you\'re on the list!</h3><p>We\'ll email you early access details.</p></div>';
      }catch(err){
        alert('There was an error saving your request locally.');
        console.error(err);
      }
    });
  }
});