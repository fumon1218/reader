// 배포용(share) 빌드 마무리: 서비스워커 캐시 이름과 매니페스트를 내 앱과 겹치지 않게 바꿉니다.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('dist/share');
const swPath = path.join(dir, 'sw.js');
fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace("'reader-shell-v1'", "'reader-share-shell-v1'"));

const mPath = path.join(dir, 'manifest.webmanifest');
const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
m.id = './';
m.description = '외국어 원서를 읽고, 모르는 단어를 탭해서 찾고, 단어장과 복습까지 이어지는 독서 앱 (배포용)';
fs.writeFileSync(mPath, JSON.stringify(m, null, 2));
console.log('share build patched');
