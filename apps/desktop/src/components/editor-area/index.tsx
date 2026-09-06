import { useActiveTab, useActiveTabId, useOpenTabs } from "@/hooks/use-tabs";
import { pageKind } from "./page-kinds";
import { pageKindView } from "./page-kinds/views";
import { EditorSearchOverlay } from "./editor-search-overlay";
import { EditorNoticeBanner } from "./editor-notice-banner";

interface EditorAreaProps {
  showFooter?: boolean;
}

function EditorArea({ showFooter = true }: EditorAreaProps) {
  const activeTab = useActiveTab();
  const activeTabId = useActiveTabId();
  const tabs = useOpenTabs();

  return (
    <div className="relative h-full overflow-hidden">
      <div className="relative h-full min-h-0 overflow-hidden">
        {tabs.map((tab) => {
          const k = pageKind(tab.location);
          const isActive = tab.id === activeTabId;
          if (!k.keepAlive && !isActive) return null;
          const Component = pageKindView(tab.location).Component as React.ComponentType<{
            location: typeof tab.location;
            isActive: boolean;
          }>;
          return <Component key={tab.id} location={tab.location} isActive={isActive} />;
        })}
      </div>
      {showFooter && activeTab
        ? pageKindView(activeTab.location).renderFooter?.(activeTab.location)
        : null}
      <EditorSearchOverlay />
      <EditorNoticeBanner />
    </div>
  );
}

export { EditorArea };
