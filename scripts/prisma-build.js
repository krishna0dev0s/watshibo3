const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Generate Prisma Client
execSync('npx prisma generate', { stdio: 'inherit' });

// Ensure the engine is copied to the correct location in production builds
const targetDir = path.join(process.cwd(), '.next/standalone/node_modules/.prisma/client/');
const engineSource = path.join(process.cwd(), 'node_modules/.prisma/client/');
const engineFiles = fs.readdirSync(engineSource).filter(f => f.includes('engine'));

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

for (const file of engineFiles) {
  fs.copyFileSync(
    path.join(engineSource, file),
    path.join(targetDir, file)
  );
  console.log(`Copied ${file} to standalone build`);
}