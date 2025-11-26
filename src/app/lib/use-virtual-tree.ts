import { useConnection } from "@/components/connection"
import { useCallback, useEffect, useMemo } from "react"
import { proxy, useSnapshot } from "valtio"
import type { MoveOperation } from "../../shared/operation"
import type { Node } from "./types"

type NodeWithChildRefs = Omit<Node, "children"> & {
  parent_id?: string
  children?: Array<string>
  loading?: boolean
}

export const state = proxy<{ [id: string]: NodeWithChildRefs }>({
  ROOT: {
    id: "ROOT",
    loading: true,
  },
})

export const useVirtualTree = () => {
  const { fetchSubtree } = useConnection()

  const snapshot = useSnapshot(state)

  const expandNode = useCallback(
    async (id: string) => {
      // Already expanded
      if (state[id]?.children) return

      state[id].loading = true
      const nodes = await fetchSubtree(id).catch(async (e) => {
        // Retry once, in case the room is not ready yet
        return fetchSubtree(id)
      })
      state[id].loading = false

      if (!state[id].children) state[id].children = []

      // Create the nodes in the state
      for (const node of nodes) {
        state[node.id] = {
          ...node,
        }
      }

      for (const node of nodes) {
        const parent = state[node.parent_id]

        if (parent) {
          parent.children?.push(node.id)
        }
      }
    },
    [fetchSubtree],
  )

  const extra = useMemo(
    () => ({
      expandNode,
    }),
    [expandNode],
  )

  const tree = useMemo(() => {
    const root = snapshot.ROOT
    if (!root) return []

    // Build the tree iteratively to avoid call-stack overflows on deep chains.
    const rootNode: Node = { ...root, children: [] }
    const stack: Array<{ id: string; node: Node }> = [{ id: "ROOT", node: rootNode }]
    const visited = new Set<string>(["ROOT"])

    while (stack.length) {
      const { id, node } = stack.pop()!
      const childIds = snapshot[id]?.children ?? []
      if (!childIds.length) {
        node.children = undefined
        continue
      }

      node.children = []
      for (const childId of childIds) {
        if (visited.has(childId)) continue
        visited.add(childId)
        const childSnapshot = snapshot[childId]
        if (!childSnapshot) continue
        const childNode: Node = { ...childSnapshot, children: [] }
        node.children.push(childNode)
        stack.push({ id: childId, node: childNode })
      }

      if (!node.children.length) {
        node.children = undefined
      }
    }

    return [rootNode]
  }, [snapshot])

  useEffect(() => {
    expandNode("ROOT")
  }, [expandNode])

  return [tree, extra] as const
}

/**
 * Insert a move operation into the virtual tree.
 * Necessary for reflecting moves that are being generated or received while
 * the virtual tree is being used.
 */
export const insertIntoVirtualTree = (move: MoveOperation) => {
  // Make sure node exists
  if (!state[move.node_id]) {
    state[move.node_id] = {
      id: move.node_id,
    }
  }

  // Make sure parent exists
  if (!state[move.new_parent_id]) {
    state[move.new_parent_id] = {
      id: move.new_parent_id,
      children: [],
    }
  }

  const node = state[move.node_id]
  const oldParent = move.old_parent_id ? state[move.old_parent_id] : null
  const parent = state[move.new_parent_id]

  node.parent_id = move.new_parent_id

  if (oldParent?.children) {
    oldParent.children = oldParent.children.filter((child) => child !== node.id)
    if (!oldParent.children.length) {
      oldParent.children = []
    }
  }

  if (!parent.children) parent.children = []
  if (!parent.children.includes(node.id)) parent.children.push(node.id)
}
