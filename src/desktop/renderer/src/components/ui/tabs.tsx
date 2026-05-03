import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { motion } from "motion/react"
import { useCallback, useLayoutEffect, useState, type Ref } from "react"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-4xl p-[3px] text-muted-foreground group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:rounded-2xl data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type TabsIndicatorPosition = {
  x: number
  y: number
  width: number
  height: number
  orientation: "horizontal" | "vertical"
}

const tabsIndicatorSpring = {
  type: "spring",
  stiffness: 430,
  damping: 30,
  mass: 0.8,
} as const

const tabsIndicatorShapeTransition = {
  duration: 0.28,
  ease: [0.2, 0, 0, 1],
} as const

function TabsList({
  className,
  variant = "default",
  ref,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants> & { ref?: Ref<HTMLDivElement> }) {
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null)
  const [indicatorPosition, setIndicatorPosition] = useState<TabsIndicatorPosition | null>(null)
  const setListRef = useCallback(
    (node: HTMLDivElement | null) => {
      setListElement(node)
      if (typeof ref === "function") {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref]
  )
  const updateIndicatorPosition = useCallback(() => {
    if (variant !== "line" || !listElement) {
      setIndicatorPosition(null)
      return
    }
    const activeTab = listElement.querySelector<HTMLElement>("[data-active]")
    if (!activeTab) {
      setIndicatorPosition(null)
      return
    }
    const rootElement = listElement.closest<HTMLElement>("[data-slot='tabs']")
    const orientation = rootElement?.dataset.orientation === "vertical" ? "vertical" : "horizontal"
    const nextPosition =
      orientation === "vertical"
        ? {
            x: activeTab.offsetLeft + activeTab.offsetWidth + 4,
            y: activeTab.offsetTop,
            width: 4,
            height: activeTab.offsetHeight,
            orientation,
          }
        : {
            x: activeTab.offsetLeft + (activeTab.offsetWidth - 64) / 2,
            y: activeTab.offsetTop + activeTab.offsetHeight + 6,
            width: 64,
            height: 4,
            orientation,
          }
    setIndicatorPosition((current) =>
      current &&
      current.x === nextPosition.x &&
      current.y === nextPosition.y &&
      current.width === nextPosition.width &&
      current.height === nextPosition.height &&
      current.orientation === nextPosition.orientation
        ? current
        : nextPosition
    )
  }, [listElement, variant])

  useLayoutEffect(() => {
    updateIndicatorPosition()
  })

  useLayoutEffect(() => {
    if (variant !== "line" || !listElement) {
      return
    }
    const resizeObserver = new ResizeObserver(updateIndicatorPosition)
    resizeObserver.observe(listElement)
    listElement.querySelectorAll<HTMLElement>("[data-slot='tabs-trigger']").forEach((tab) => resizeObserver.observe(tab))
    const mutationObserver = new MutationObserver(updateIndicatorPosition)
    mutationObserver.observe(listElement, {
      attributes: true,
      attributeFilter: ["data-active"],
      subtree: true,
    })
    window.addEventListener("resize", updateIndicatorPosition)
    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener("resize", updateIndicatorPosition)
    }
  }, [listElement, updateIndicatorPosition, variant])

  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      ref={setListRef}
      className={cn(tabsListVariants({ variant }), variant === "line" && "relative", className)}
      {...props}
    >
      {props.children}
      {variant === "line" && indicatorPosition ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute z-0 rounded-full bg-[var(--lime-9)]"
          initial={false}
          animate={{
            x: indicatorPosition.x,
            y: indicatorPosition.y,
            width: indicatorPosition.width,
            height: indicatorPosition.height,
            scaleX: indicatorPosition.orientation === "horizontal" ? [0.99, 1.018, 1] : 1,
            scaleY: indicatorPosition.orientation === "vertical" ? [1.012, 0.992, 1] : [1.012, 0.992, 1],
          }}
          transition={{
            x: tabsIndicatorSpring,
            y: tabsIndicatorSpring,
            width: tabsIndicatorSpring,
            height: tabsIndicatorSpring,
            scaleX: tabsIndicatorShapeTransition,
            scaleY: tabsIndicatorShapeTransition,
          }}
          style={{ left: 0, top: 0, transformOrigin: "center" }}
        />
      ) : null}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-xl border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:px-2.5 group-data-vertical/tabs:py-1.5 hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
