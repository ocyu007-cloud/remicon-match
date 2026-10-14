'use client';

/** 현장 — Revit 3D 모델 보기. 모델은 미리 변환해 둔 것 하나를 보여 준다 (components/ModelViewer). */

import { SiteShell } from '@/components/RoleShells';
import ModelViewer from '@/components/ModelViewer';
import { Panel } from '@/components/ui';

export default function ModelPage() {
  return (
    <SiteShell
      title="3D 모델"
      description="Revit 모델을 돌려 보고 확대해서 봅니다. 부재를 누르면 정보가 나옵니다."
      showClock={false}
    >
      {() => (
        <Panel title="현장 모델">
          <ModelViewer />
        </Panel>
      )}
    </SiteShell>
  );
}
