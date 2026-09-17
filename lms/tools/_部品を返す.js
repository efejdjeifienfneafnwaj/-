/* テスト用サーバーの共通部分：ウィジェットの部品（css/js）をファイルから返す。
   返さないと、社内申請の js が HTML として読まれて SyntaxError になる。 */
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'lms-widget', 'app');
const MIME = { '.js':'application/javascript', '.css':'text/css', '.json':'application/json' };
module.exports = function serveAsset(req, res){
  const u = String(req.url || '/').split('?')[0];
  if(u === '/' || u === '/widget.html') return false;
  const f = path.join(APP, u);
  if(!f.startsWith(APP) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
  res.end(fs.readFileSync(f));
  return true;
};
