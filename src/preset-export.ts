import { dump } from 'js-yaml';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import type { PresetPolicyConfig } from './host/preset-policy.ts';
import { PACKAGE_NAME, POLICY_PLUGIN, STUDIO_VERSION } from './package-name.ts';

export interface PresetBundleInput {
  id: string;
  title: string;
  /** Server-compiled Cordis entry rows, including trusted Loader expressions. */
  plugins: unknown[];
  policy: PresetPolicyConfig;
  dependencies?: Record<string, string>;
  shellVersion?: string;
}
export interface PresetBundleFiles { files: Record<string, string> }

/** Pure download payload. Does not write files, install packages, or modify profiles. */
export function createPresetBundle(input: PresetBundleInput): PresetBundleFiles {
  if (!/^[a-z][a-z0-9-]*$/.test(input.id) || ['standard', 'minimal', 'ptc', 'cordis'].includes(input.id)) throw new Error('Choose a new lowercase Studio preset id');
  if (!input.title.trim() || !Array.isArray(input.plugins)) throw new Error('Invalid preset bundle');
  const plugins = [...input.plugins];
  plugins.push({ id: 'studio-policy', name: POLICY_PLUGIN, config: input.policy });
  const manifest = {
    name: `@local/dsh-studio-preset-${input.id}`, version: '1.0.0', private: true, type: 'module',
    dependencies: { ...input.dependencies, [PACKAGE_NAME]: input.shellVersion ?? STUDIO_VERSION },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  };
  const patch = [{ insert: [{ id: `preset-${input.id}`, name: '@deepseek-ai/dsh-agent-preset', config: { id: input.id, name: input.title, plugins } }] }];
  return { files: {
    'package.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'cordis.patch.yml': dump(patch, { schema: entryListSchema, noRefs: true, lineWidth: -1 }),
    'README.ko.md': `# ${input.title}\n\nStudio가 만든 프리셋 번들입니다. 원본 프리셋은 변경하지 않습니다.\n\n- 대상 DSH: Studio 패키지의 peerDependencies와 일치하는 수정하지 않은 런타임.\n- 필요한 Studio 패키지: ${PACKAGE_NAME}@${input.shellVersion ?? STUDIO_VERSION}. npm에서 설치하거나 배포자가 제공한 tarball을 먼저 설치해야 합니다.\n- 이 다운로드에는 shell 실행 코드나 외부 플러그인 패키지가 포함되지 않습니다. manifest의 의존성을 배포 환경에서 해결해야 합니다.\n- DSH 플러그인 관리 기능으로 이 디렉터리를 번들로 설치한 뒤 새 세션에서 ${input.id} 프리셋을 선택하세요.\n- 설치는 코드를 실행하므로 의존성과 설정을 검토하세요. 이 파일 생성은 설치/프로필 변경을 수행하지 않습니다.\n- 개발 환경 테스트와 독립 런타임 설치 검증은 별개입니다.\n`,
  } };
}
