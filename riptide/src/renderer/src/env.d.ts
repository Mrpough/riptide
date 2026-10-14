/// <reference types="vite/client" />
import type * as React from 'react'
import type { RiptideApi } from '../../preload/api'

/**
 * Ambient declarations for the renderer.
 *
 * React 19 no longer ships a global `JSX` namespace (it lives at
 * `React.JSX`), but the renderer components annotate their return type as
 * `JSX.Element`. Re-expose the namespace globally so those annotations keep
 * working, and declare the context-bridge surface on `window`.
 */
declare global {
  namespace JSX {
    type Element = React.JSX.Element
    type ElementType = React.JSX.ElementType
    type ElementClass = React.JSX.ElementClass
    type ElementAttributesProperty = React.JSX.ElementAttributesProperty
    type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute
    type IntrinsicAttributes = React.JSX.IntrinsicAttributes
    type IntrinsicClassAttributes<T> = React.JSX.IntrinsicClassAttributes<T>
    type IntrinsicElements = React.JSX.IntrinsicElements
  }

  interface Window {
    riptide: RiptideApi
  }
}

export {}
