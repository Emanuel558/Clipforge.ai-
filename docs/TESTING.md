# Phase 1 browser checklist

Start the app using README.md. Use a short MP4 with visible movement and audible speech or a tone. Begin with the generated demo for repeatable testing.

## Dashboard and upload

- Open Dashboard. Confirm an empty workspace shows a clear upload action.
- Open Upload video using the sidebar and the New project button.
- Select a non-MP4 file. Confirm a readable error appears.
- Upload an empty MP4. Confirm an error appears.
- Select a valid MP4. Confirm progress appears and reaches validation/preparation.
- During a sufficiently large upload, press Pause upload. Confirm saved progress stays visible and Resume upload is available.
- Drag and drop an MP4 onto the upload area. Confirm the same workflow works.
- Wait for preparation and the preview screen. Open Dashboard and confirm the new project thumbnail and information.

## Preview and trim

- Play the source. Check sound, picture and the native player seeking controls.
- Set start to 1 and end to 3 seconds. Preview selection. Confirm playback begins at 1 and stops near 3.
- Move the playhead, then use each Use playhead button. Confirm the corresponding field changes.
- Enter a negative start, an empty field, end before start, and an end beyond the source duration. Confirm an error and disabled export.
- Enter valid times again. Confirm export becomes available.
- Note: timestamps use seconds. Decimal values such as 1.5 are accepted. The timeline strip is a visual guide, rather than draggable trim handles.

## Export and recovery

- Press Export clip. Confirm queued/rendering progress appears. The button prevents a duplicate export while busy.
- Wait for completion. Download the clip and open the downloaded file in the browser or a video player.
- Confirm duration matches end minus start. Check the first and last visible moments. Listen for matching sound.
- Refresh the app and reopen the project. Confirm export history and the last submitted trim settings return.
- Export a second selection. Confirm both downloads remain available.
- While an export is running, restart the server. Reopen the project. Confirm the interrupted job displays an error and a new export succeeds.
- Disconnect the browser network during an upload. Reconnect and confirm another upload succeeds.

## Layout and cleanup

- Test at desktop and narrow phone-sized browser widths. Confirm the preview, time fields and download controls stay reachable.
- Use Tab and Enter to navigate buttons and inputs. Confirm visible focus indicators.
- Open deletion confirmation, then choose Keep project. Confirm no files disappear.
- Delete a completed project. Confirm the dashboard updates and its source and exports disappear from the server data folder.
- Confirm a processing project refuses deletion with a clear message.

## Verification recorded during development

Automated checks exercise the real media workflow, rather than mocked successful exports. Exact results are recorded in the pull request.

The managed browser preview initially failed before the app loaded because the environment could not enumerate network interfaces for Vite. Automated API/media tests and frontend compilation remain available. Complete this browser checklist in the private Codespace before treating interface QA as finished.

## Large-upload regression checks

The owner verified the original three-minute upload, trim, export and download in a browser, with picture and sound. A 676 MB, 25:51 upload stalled. No browser network trace or server log from the stalled transfer is available, so its exact cause is unconfirmed.

The new browser uploader sends 4 MiB chunks with server receipts. Test the updated branch after pulling changes and restarting the development server. Reload the ClipForge browser tab to load the new uploader.

- Upload the original 676 MB file. Confirm saved MB and percentage advance, with sent bytes, transfer speed and an estimated remaining time while sending.
- Press Pause upload after several chunks. Press Resume upload. Confirm the saved count continues rather than restarting at zero.
- Pause, reload the page, open Upload video, and choose the same file with Resume upload. Browser security requires selecting the original file again after reload. Name, size and modification time identify the selection. Renaming or modifying the file requires discarding the prior upload.
- Interrupt the network during a chunk. Restore the connection. The app checks the saved offset before retrying. After three automatic retries, a readable error and manual Resume upload action should remain.
- If the browser or proxy provides neither progress nor a receipt for 90 seconds, confirm the request stops and retry status appears. Metadata requests time out after 30 seconds. Each chunk has a ten-minute absolute request limit.
- Confirm the saved counter only reaches 100% after the server acknowledges all bytes. The next label must say the video is being checked, rather than leaving the transfer progress unexplained.
- After transfer, keep the workspace running while validation and preview preparation finish. Validation requests return promptly and background status is polled separately.
- Reopen the project, preview the picture and sound, export a short selection, and download the result.
- Pause an upload and choose Discard saved upload. Confirm partial data is removed and another file is accepted.
- Keep the forwarded port private. An expired GitHub login should display an access error rather than an unexplained stuck bar.

Automated frontend transport tests:

```bash
npm --prefix frontend test
```

Opt-in full-volume backend test, with generated footage and approximately 1.4 GB of temporary disk space:

```bash
CLIPFORGE_LARGE_TEST=1 .venv/bin/python -m pytest backend/tests/test_uploads.py::test_676_mib_25m51s_transfer -q
```

This test transfers a valid 676 MiB MP4 with 25:51 duration. A valid MP4 padding box supplies the byte volume. It checks all chunk receipts, media validation and the saved project. This tests byte volume and duration through the API, rather than the owner's original video or the Codespaces forwarded-port network.
