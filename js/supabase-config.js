// Supabase 项目配置。anon/public key 是设计成可以公开写在前端代码里的，
// 真正的数据访问权限由 Supabase 的 Row Level Security 策略控制，不依赖这个 key 保密。
var SUPABASE_URL = 'https://eonzswndrzvxzbkwhjwu.supabase.co';
var SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvbnpzd25kcnp2eHpia3doand1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNjI0MDIsImV4cCI6MjEwMTczODQwMn0.YPPP-tZvklgXOlt2PfKa833IhgpBdmneGRCzUPNqZWM';

var supabaseClient =
  window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
