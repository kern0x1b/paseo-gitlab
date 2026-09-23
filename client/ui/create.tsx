import { useRpc } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { createIssueRpc, createMergeRequestRpc, type ItemRef } from "../../shared/contract";
import { Button, errorText, IconButton } from "./common";
import type { Ui } from "./detail";

export type CreateTarget =
  | { mode: "issue"; projectPath: string }
  | { mode: "mr"; projectPath: string; sourceBranch: string; targetBranch: string };

/** A new issue in a project, or a new MR from a branch; opens the result when GitLab has it. */
export function CreateView({
  target,
  onBack,
  onCreated,
  ui,
}: {
  target: CreateTarget;
  onBack: () => void;
  onCreated: (ref: ItemRef) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const createIssue = useRpc(createIssueRpc);
  const createMergeRequest = useRpc(createMergeRequestRpc);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [projectPath, setProjectPath] = useState(target.projectPath);
  const [targetBranch, setTargetBranch] = useState(target.mode === "mr" ? target.targetBranch : "");
  const [title, setTitle] = useState(target.mode === "mr" ? `Draft: ${target.sourceBranch}` : "");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const ref =
        target.mode === "issue"
          ? await createIssue({ projectPath: projectPath.trim(), title: title.trim(), description })
          : await createMergeRequest({
              projectPath: projectPath.trim(),
              title: title.trim(),
              description,
              sourceBranch: target.sourceBranch,
              targetBranch: targetBranch.trim(),
            });
      void queryClient.invalidateQueries({ queryKey: ["gitlab"] });
      toast.show(target.mode === "issue" ? "Issue created" : "Merge request created", { variant: "success" });
      onCreated(ref);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const field = [styles.input, { minHeight: 0 }];
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.row}>
        <IconButton icon="ChevronLeft" label="Back" onPress={onBack} theme={theme} styles={styles} />
        <Text style={styles.title}>{target.mode === "issue" ? "New issue" : "New merge request"}</Text>
      </View>
      <View style={styles.card}>
        <View style={styles.cardBody}>
          <Text style={styles.sectionTitle}>Project</Text>
          <TextInput value={projectPath} onChangeText={setProjectPath} editable={!saving} style={field} />
          {target.mode === "mr" ? (
            <>
              <Text style={styles.sectionTitle}>Branches</Text>
              <View style={styles.row}>
                <Text style={styles.text}>{target.sourceBranch} →</Text>
                <TextInput
                  value={targetBranch}
                  onChangeText={setTargetBranch}
                  editable={!saving}
                  style={[field, { flex: 1 }]}
                />
              </View>
            </>
          ) : null}
          <Text style={styles.sectionTitle}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            editable={!saving}
            autoFocus
            style={field}
            placeholderTextColor={theme.colors.foregroundMuted}
          />
          <Text style={styles.sectionTitle}>Description (Markdown)</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            editable={!saving}
            style={[styles.input, { minHeight: 160 }]}
            placeholderTextColor={theme.colors.foregroundMuted}
          />
          <View style={styles.row}>
            <View style={styles.spacer} />
            <Button label="Cancel" onPress={onBack} styles={styles} theme={theme} />
            <Button
              label={target.mode === "issue" ? "Create issue" : "Create merge request"}
              primary
              busy={saving}
              disabled={
                !title.trim() || !projectPath.trim() || (target.mode === "mr" && !targetBranch.trim())
              }
              onPress={() => void save()}
              styles={styles}
              theme={theme}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
