import React, { createContext, useContext, useMemo } from 'react';

interface EditorVisibilityContextValue {
  visible: boolean;
  setVisible: (show: boolean) => void;
}

const noop = () => {};

const EditorVisibilityContext = createContext<EditorVisibilityContextValue>({
  visible: true,
  setVisible: noop,
});

export function EditorVisibilityProvider({
  visible,
  setVisible = noop,
  children,
}: {
  visible: boolean;
  setVisible?: (show: boolean) => void;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ visible, setVisible }), [visible, setVisible]);
  return (
    <EditorVisibilityContext.Provider value={value}>
      {children}
    </EditorVisibilityContext.Provider>
  );
}

export function useEditorVisibility(): EditorVisibilityContextValue {
  return useContext(EditorVisibilityContext);
}
